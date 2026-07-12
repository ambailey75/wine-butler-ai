// One-time retroactive normalization pass over every wine in the cellar.
// Run with: npm run normalize-cellar -- --dry-run   (logs only, no writes)
//           npm run normalize-cellar                (applies unambiguous changes)
//
// Uses relative imports (not @/lib/...) so this can run standalone via
// ts-node outside Next's bundler — see scripts/tsconfig.json.
import { writeFileSync } from 'fs'
import { join } from 'path'
import { prisma } from '../lib/prisma/client'
import { normalizeVarietal, normalizeRegionAndSubRegion, normalizeRegionSpelling } from '../lib/wines/normalize'
import { VARIETAL_MAP, PROTECTED_BLEND_NAMES } from '../lib/wines/varietal-data'

interface AppliedChange {
  wineId: string
  producer: string
  wineName: string
  field: string
  oldValue: string | null
  newValue: string
}

interface SkippedChange {
  wineId: string
  producer: string
  wineName: string
  field: string
  oldValue: string | null
  proposedValue: string
  reason: string
}

const isDryRun = process.argv.includes('--dry-run')

// A varietal change is only "unambiguous" if every component resolved
// through a real dictionary lookup — not the title-case fallback for an
// unrecognized grape name, which is a best guess rather than a verified
// correction.
function isVarietalUnambiguous(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return true
  const wholeKey = trimmed.toLowerCase()
  if (PROTECTED_BLEND_NAMES.has(wholeKey)) return true
  const components = trimmed.split(/[/;,]/).map((c) => c.trim()).filter(Boolean)
  return components.every((c) => VARIETAL_MAP[c.toLowerCase()] !== undefined)
}

async function main() {
  const wines = await prisma.wine.findMany()

  const applied: AppliedChange[] = []
  const skipped: SkippedChange[] = []

  for (const wine of wines) {
    const updates: Record<string, string> = {}
    const label = { wineId: wine.id, producer: wine.producer, wineName: wine.wineName }

    if (wine.varietal) {
      const newVarietal = normalizeVarietal(wine.varietal)
      if (newVarietal && newVarietal !== wine.varietal) {
        if (isVarietalUnambiguous(wine.varietal)) {
          updates.varietal = newVarietal
          applied.push({ ...label, field: 'varietal', oldValue: wine.varietal, newValue: newVarietal })
        } else {
          skipped.push({
            ...label,
            field: 'varietal',
            oldValue: wine.varietal,
            proposedValue: newVarietal,
            reason: 'Contains an unrecognized grape/blend component — verify before applying',
          })
        }
      }
    }

    const regionResult = normalizeRegionAndSubRegion(wine.region ?? undefined, wine.subRegion ?? undefined, wine.country ?? undefined)
    if (regionResult.ambiguous) {
      if (wine.region || wine.subRegion) {
        skipped.push({
          ...label,
          field: 'region/subRegion',
          oldValue: `${wine.region ?? ''} / ${wine.subRegion ?? ''}`,
          proposedValue: '(ambiguous — needs manual review)',
          reason: 'Sub-region is ambiguous (e.g. Carneros, Sonoma Valley) — left unchanged',
        })
      }
    } else {
      if (regionResult.region && regionResult.region !== (wine.region ?? '')) {
        updates.region = regionResult.region
        applied.push({ ...label, field: 'region', oldValue: wine.region, newValue: regionResult.region })
      }
      if (regionResult.subRegion && regionResult.subRegion !== (wine.subRegion ?? '')) {
        updates.subRegion = regionResult.subRegion
        applied.push({ ...label, field: 'subRegion', oldValue: wine.subRegion, newValue: regionResult.subRegion })
      }
      if (regionResult.appellation && !wine.appellation) {
        updates.appellation = regionResult.appellation
        applied.push({ ...label, field: 'appellation', oldValue: wine.appellation, newValue: regionResult.appellation })
      }
    }

    if (wine.country) {
      const newCountry = normalizeRegionSpelling(wine.country)
      if (newCountry !== wine.country) {
        updates.country = newCountry
        applied.push({ ...label, field: 'country', oldValue: wine.country, newValue: newCountry })
      }
    }

    if (wine.state) {
      const newState = normalizeRegionSpelling(wine.state)
      if (newState !== wine.state) {
        updates.state = newState
        applied.push({ ...label, field: 'state', oldValue: wine.state, newValue: newState })
      }
    }

    if (Object.keys(updates).length > 0 && !isDryRun) {
      await prisma.wine.update({ where: { id: wine.id }, data: updates })
    }
  }

  const log = {
    generatedAt: new Date().toISOString(),
    dryRun: isDryRun,
    totalWines: wines.length,
    appliedCount: applied.length,
    skippedCount: skipped.length,
    applied,
    skipped,
  }
  writeFileSync(join(__dirname, 'normalize-cellar-log.json'), JSON.stringify(log, null, 2))

  console.log(`${isDryRun ? '[DRY RUN] ' : ''}normalize-cellar complete.`)
  console.log(`  Wines scanned: ${wines.length}`)
  console.log(`  Field changes applied: ${applied.length}`)
  console.log(`  Skipped for manual review: ${skipped.length}`)
  console.log('  Full log: scripts/normalize-cellar-log.json')
}

main()
  .catch((err) => {
    console.error('normalize-cellar failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
