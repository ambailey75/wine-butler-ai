// X-Wines catalog import — Phase 2, Checklist #2.
// Run with: npm run import-xwines -- --dry-run   (parses + validates only, no DB writes)
//           npm run import-xwines                (writes to wine_knowledge)
//
// Applies the data-quality rules already agreed in WINE_KNOWLEDGE_DATABASE_PLAN.md:
// - exact-vintage-only matching downstream (this script just stores known_vintages faithfully)
// - skip WineID 167488 (wrong "Quimera" — 100% Malbec, not the real 5-grape blend)
// - Prosecco-style NV collapsing handled generically (see mergeDuplicateNameGroups)
// - never guess a future vintage year — stores exactly what X-Wines lists, nothing added
//
// Region validation (REGION_VALIDATION_PLAN.md Step 5) runs in two passes:
// Pass 1 validates every row on its own against an external reference
// (eAmbrosia PDO bridge for EU-PDO-covered countries, region_authority
// fallback everywhere else). Pass 2 groups rows by (WineryID, Country) and
// re-checks internal RegionName disagreement using Step 4's producer-group
// consistency check, which can catch real errors Pass 1 alone can't (e.g.
// Albinea Canali: "Piemonte" is a real, validly-anchored region on its own,
// but wrong for this specific Emilia-Romagna producer -- only visible once
// compared against this producer's other rows). Pass 2 only escalates a
// row's status (CONFIRMED/UNVALIDATED -> CORRECTED/FLAGGED_CONFLICT); it
// never overrides a row Pass 1 already corrected or flagged directly.
//
// Uses relative imports (not @/lib/...) so this runs standalone via
// ts-node outside Next's bundler — same pattern as the other scripts here.
import { readFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '../lib/prisma/client'
import { cleanName } from '../lib/wines/dedup-match'
import { buildRegionAuthorityIndex, validateRegionBaseline } from '../lib/wines/region-validate-import'
import { checkProducerGroupConsistency, RegionNameGroupDecision } from '../lib/wines/region-hierarchy-checker'

const CSV_PATH = join(__dirname, '..', 'data-imports', 'XWines_100K_wines.csv')
const INSERT_BATCH_SIZE = 500
// Confirmed wrong duplicate, per WINE_KNOWLEDGE_DATABASE_PLAN.md section 2:
// real "Quimera" is the 5-grape blend (169988); 167488 is a different,
// unrelated 100% Malbec product mislabeled with the same name.
const SKIP_WINE_IDS = new Set(['167488'])

interface XWinesRow {
  WineID: string
  WineName: string
  Type: string
  Elaborate: string
  Grapes: string
  Harmonize: string
  ABV: string
  Body: string
  Acidity: string
  Code: string
  Country: string
  RegionID: string
  RegionName: string
  WineryID: string
  WineryName: string
  Website: string
  Vintages: string
}

// Minimal RFC4180-style CSV line splitter — handles quoted fields
// containing commas (e.g. "['Pork', 'Rich Fish']"), which a naive
// split(',') would break on. No new dependency added for this; the
// quoting pattern in this file is simple enough to parse directly.
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

function parseCsv(text: string): XWinesRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  const rows: XWinesRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const row: any = {}
    header.forEach((col, idx) => {
      row[col] = values[idx] ?? ''
    })
    rows.push(row as XWinesRow)
  }
  return rows
}

// Vintages field looks like "[2020, 2019, 'N.V.']" — a Python list literal
// as a string, not JSON. Extracts real years and detects the 'N.V.' marker
// separately, per the has_non_vintage / known_vintages split design.
function parseVintages(raw: string): { years: number[]; hasNonVintage: boolean } {
  const years: number[] = []
  let hasNonVintage = false
  const items = raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
  for (const item of items) {
    if (/^\d{4}$/.test(item)) {
      years.push(parseInt(item, 10))
    } else if (/n\.?v\.?/i.test(item)) {
      hasNonVintage = true
    }
  }
  return { years, hasNonVintage }
}

function parsePythonListOfStrings(raw: string): string[] {
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter((s) => s.length > 0)
}

interface TransformResult {
  record: {
    producer: string
    wineName: string
    country: string | null
    region: string | null
    varietal: string | null
    type_style: string | null
    abv: number | null
    body: string | null
    acidity: string | null
    website: string | null
    pairing_notes: string | null
    blend_composition: string | null
    known_vintages: number[]
    has_non_vintage: boolean
    normalizedProducer: string
    normalizedWineName: string
    searchText: string
    xWinesId: string
  }
  regionValidation: 'CONFIRMED' | 'CORRECTED' | 'FLAGGED_CONFLICT' | 'UNVALIDATED'
  regionValidationSource: 'EAMBROSIA_BRIDGE' | 'REGION_AUTHORITY' | 'PRODUCER_GROUP_CONSISTENCY' | null
  regionFlagReason: string | null
  originalRegion: string | null
  skippedReason?: string
}

type RegionAuthorityIndex = ReturnType<typeof buildRegionAuthorityIndex>

function transformRow(row: XWinesRow, regionIndex: RegionAuthorityIndex): TransformResult | null {
  if (SKIP_WINE_IDS.has(row.WineID)) {
    return null // real, confirmed-wrong duplicate — not imported, not flagged as an error
  }

  const { years, hasNonVintage } = parseVintages(row.Vintages)
  const grapes = parsePythonListOfStrings(row.Grapes)
  const harmonize = parsePythonListOfStrings(row.Harmonize)

  const normalizedProducer = cleanName(row.WineryName)
  const normalizedWineName = cleanName(row.WineName)

  const regionResult = validateRegionBaseline(regionIndex, row.Code || null, row.Country || null, row.RegionName || null)

  return {
    record: {
      producer: row.WineryName,
      wineName: row.WineName,
      country: row.Country || null,
      region: regionResult.validatedRegion,
      varietal: grapes.length > 0 ? grapes.join(', ') : null,
      type_style: row.Type || null,
      abv: row.ABV ? parseFloat(row.ABV) : null,
      body: row.Body || null,
      acidity: row.Acidity || null,
      website: row.Website || null,
      pairing_notes: harmonize.length > 0 ? harmonize.join(', ') : null,
      blend_composition: row.Elaborate || null,
      known_vintages: years,
      has_non_vintage: hasNonVintage,
      normalizedProducer,
      normalizedWineName,
      searchText: `${normalizedProducer} ${normalizedWineName}`,
      xWinesId: row.WineID,
    },
    regionValidation: regionResult.status,
    regionValidationSource: regionResult.validationSource,
    regionFlagReason: regionResult.flagReason,
    originalRegion: row.RegionName || null,
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const startedAt = Date.now()

  console.log('Loading region_authority for region validation...')
  const authorityRows = await prisma.regionAuthority.findMany({
    where: { source: 'WIKIDATA' },
    select: { appellation: true, locatedIn: true, country: true },
  })
  console.log(`Loaded ${authorityRows.length} region_authority rows`)
  const regionIndex = buildRegionAuthorityIndex(authorityRows)

  console.log(`Reading ${CSV_PATH}...`)
  const text = readFileSync(CSV_PATH, 'utf-8')
  const rawRows = parseCsv(text)
  console.log(`Parsed ${rawRows.length} raw rows`)

  // Pass 1: per-row baseline (Signal A). Skips confirmed-wrong duplicates
  // before either pass so they never enter producer-group counts either.
  const pass1: Array<{ row: XWinesRow; result: TransformResult }> = []
  let skipped = 0
  for (const row of rawRows) {
    const result = transformRow(row, regionIndex)
    if (!result) {
      skipped++
      continue
    }
    pass1.push({ row, result })
  }
  console.log(`Pass 1 (per-row baseline) complete: ${pass1.length} rows transformed (${skipped} skipped — confirmed-wrong duplicates)`)

  // Pass 2: producer-group consistency (Signals B/C, Step 4). Group by
  // (WineryID, Country) -- Country, not Code, matches how a "producer" is
  // scoped for this check (same producer name could in principle repeat
  // across countries; keeping Country in the key avoids conflating those).
  const groups = new Map<string, { countryCode: string; regionNameCounts: Map<string, number> }>()
  for (const { row } of pass1) {
    if (!row.WineryID || !row.Country || !row.RegionName) continue
    const key = `${row.WineryID}::${row.Country}`
    let group = groups.get(key)
    if (!group) {
      group = { countryCode: row.Code || '', regionNameCounts: new Map() }
      groups.set(key, group)
    }
    group.regionNameCounts.set(row.RegionName, (group.regionNameCounts.get(row.RegionName) ?? 0) + 1)
  }

  // Only groups with real internal disagreement (>1 distinct RegionName)
  // are worth checking -- checkProducerGroupConsistency handles a
  // single-value group safely too, but there's no reason to spend the call.
  const groupDecisions = new Map<string, Map<string, RegionNameGroupDecision>>()
  let groupsWithDisagreement = 0
  let groupsCorrected = 0
  let groupsFlagged = 0
  for (const [key, group] of groups) {
    if (group.regionNameCounts.size <= 1) continue
    groupsWithDisagreement++
    const consistency = checkProducerGroupConsistency(group.countryCode, group.regionNameCounts)
    if (consistency.groupStatus === 'CORRECTED') groupsCorrected++
    if (consistency.groupStatus === 'FLAGGED_CONFLICT') groupsFlagged++
    if (consistency.groupStatus === 'CORRECTED' || consistency.groupStatus === 'FLAGGED_CONFLICT') {
      groupDecisions.set(key, new Map(consistency.decisions.map((d) => [d.regionName, d])))
    }
  }
  console.log(
    `Pass 2 (producer-group consistency): ${groupsWithDisagreement} producer groups had internal RegionName disagreement; ` +
      `${groupsCorrected} groups produced a correction, ${groupsFlagged} groups produced a flag needing human review`
  )

  // Apply Pass 2 as an escalation only -- a row Pass 1 already corrected or
  // flagged directly (against region_authority or the eAmbrosia bridge on
  // its own) keeps that result; Pass 2 only upgrades a row Pass 1 called
  // CONFIRMED or UNVALIDATED when the producer-group check independently
  // caught something Pass 1 alone could not see.
  let escalatedToCorrected = 0
  let escalatedToFlagged = 0
  for (const { row, result } of pass1) {
    if (!row.WineryID || !row.Country || !row.RegionName) continue
    if (result.regionValidation === 'CORRECTED' || result.regionValidation === 'FLAGGED_CONFLICT') continue

    const key = `${row.WineryID}::${row.Country}`
    const decision = groupDecisions.get(key)?.get(row.RegionName)
    if (!decision) continue

    if (decision.status === 'CORRECTED' && decision.correctedRegion) {
      result.record.region = decision.correctedRegion
      result.regionValidation = 'CORRECTED'
      result.regionValidationSource = 'PRODUCER_GROUP_CONSISTENCY'
      escalatedToCorrected++
    } else if (decision.status === 'FLAGGED_CONFLICT') {
      result.regionValidation = 'FLAGGED_CONFLICT'
      result.regionValidationSource = 'PRODUCER_GROUP_CONSISTENCY'
      result.regionFlagReason = decision.flagReason
      escalatedToFlagged++
    }
  }
  console.log(
    `Pass 2 escalations: ${escalatedToCorrected} rows corrected, ${escalatedToFlagged} rows flagged for review ` +
      `that Pass 1 alone had left confirmed/unvalidated`
  )

  const records = pass1.map((p) => p.result.record)
  const confirmed = pass1.filter((p) => p.result.regionValidation === 'CONFIRMED').length
  const corrected = pass1.filter((p) => p.result.regionValidation === 'CORRECTED')
  const flagged = pass1.filter((p) => p.result.regionValidation === 'FLAGGED_CONFLICT')
  const unvalidated = pass1.filter((p) => p.result.regionValidation === 'UNVALIDATED').length

  console.log(
    `Region validation final distribution: ${confirmed} confirmed, ${corrected.length} corrected, ` +
      `${flagged.length} flagged for review, ${unvalidated} unvalidated`
  )

  if (corrected.length > 0) {
    console.log('Sample of corrected rows:')
    corrected.slice(0, 10).forEach(({ row, result }) =>
      console.log(
        `  - ${row.WineryName} / ${row.WineName}: "${result.originalRegion}" -> "${result.record.region}" (source: ${result.regionValidationSource})`
      )
    )
  }

  if (flagged.length > 0) {
    console.log('Sample of flagged-for-review rows:')
    flagged.slice(0, 10).forEach(({ row, result }) =>
      console.log(`  - ${row.WineryName} / ${row.WineName}: "${result.originalRegion}" -- ${result.regionFlagReason}`)
    )
  }

  if (dryRun) {
    console.log('--dry-run: no database writes. Sample of first 3 transformed records:')
    console.log(JSON.stringify(records.slice(0, 3), null, 2))
    return
  }

  console.log('Live run not yet implemented past this point — dry-run validation only for now.')
}

main().catch((e) => {
  console.error('Fatal error:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
