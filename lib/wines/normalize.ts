import type { MappedWineData } from '../import/constants'
import { cleanFieldValue } from '../import/clean-field-values'
import { VARIETAL_MAP, PROTECTED_BLEND_NAMES } from './varietal-data'
import {
  REGION_SUBREGION_PAIRS,
  REGION_SPELLING_CORRECTIONS,
  APPELLATION_LOOKUP,
  QUALITY_TIER_LOOKUP,
  AMBIGUOUS_SUBREGIONS,
  COUNTRY_STATE_PAIRS,
} from './region-data'

// Single source of truth for all wine data normalization — used at import
// time, enrichment time, and by the retroactive migration script
// (scripts/normalize-cellar.ts). See lib/wines/varietal-data.ts and
// lib/wines/region-data.ts for the underlying lookup tables.

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
}

function normalizeVarietalComponent(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const canonical = VARIETAL_MAP[trimmed.toLowerCase()]
  return canonical ?? titleCase(trimmed)
}

/**
 * Normalizes a single varietal or blend string. Whole-string blend
 * descriptors (GSM, Meritage, Bordeaux Blend, ...) are preserved as-is and
 * never split. Anything else is split on `/`, `;`, `,`, each component is
 * normalized independently (shorthand expanded, misspellings corrected),
 * and the result is rejoined with " / ". Unrecognized components fall back
 * to a title-cased version of the raw text rather than being dropped.
 */
export function normalizeVarietal(raw: string): string {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const wholeKey = trimmed.toLowerCase()
  if (PROTECTED_BLEND_NAMES.has(wholeKey)) {
    return VARIETAL_MAP[wholeKey] ?? titleCase(trimmed)
  }

  const components = trimmed
    .split(/[/;,]/)
    .map((c) => c.trim())
    .filter(Boolean)

  if (components.length <= 1) {
    return normalizeVarietalComponent(trimmed)
  }

  return components.map(normalizeVarietalComponent).join(' / ')
}

/**
 * Pure spelling/capitalization/accent correction for a single region-ish
 * value (region, sub-region, country, or state name). No splitting. Returns
 * the input unchanged (trimmed) if there's no known correction.
 */
export function normalizeRegionSpelling(raw: string): string {
  if (typeof raw !== 'string') return raw
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const corrected = REGION_SPELLING_CORRECTIONS[trimmed.toLowerCase()]
  return corrected ?? trimmed
}

const REGION_SPLIT_SEPARATORS = [' > ', ' | ', ' / ', ', ', ' - ', ' . ']

/**
 * Splits a combined "Region > SubRegion"-style value on the first
 * recognized separator. Exported so display-layer code (WineTable.tsx) can
 * defensively re-split a value that should already be split but isn't —
 * e.g. legacy rows written before normalization existed, or rows edited
 * inline (which bypasses the import pipeline).
 */
export function splitCombinedValue(value: string): { first: string; second: string } | null {
  for (const sep of REGION_SPLIT_SEPARATORS) {
    const idx = value.indexOf(sep)
    if (idx > -1) {
      return { first: value.slice(0, idx).trim(), second: value.slice(idx + sep.length).trim() }
    }
  }
  return null
}

// Trailing designation suffix on a sub-region value, e.g. "Stags Leap
// District AVA" -> strip to subRegion "Stags Leap District", keep the full
// string as appellation. Longest tokens first so DOCG/DOCa aren't shadowed
// by a partial DOC match (moot given the trailing anchor, but kept explicit).
const DESIGNATION_SUFFIX = /\s*,?\s*(DOCG|DOCa|DOC|AOC|AVA|WO|GI)\s*$/i

// Same token set, unanchored — used to detect a designation suffix anywhere
// in a classification value (e.g. a bare "DOCG" with no place name at all).
const DESIGNATION_TOKEN_ANYWHERE = /\b(DOCG|DOCa|DOC|AOC|AVA|WO|GI)\b/i

// Flattened set of every region and sub-region name known to
// APPELLATION_LOOKUP, lowercase — used to catch a classification value that
// is actually a place name with no designation suffix attached (e.g. a
// stray "Chianti Classico" typed into the classification field).
const KNOWN_PLACE_NAMES: Set<string> = (() => {
  const names = new Set<string>()
  for (const [region, subRegions] of Object.entries(APPELLATION_LOOKUP)) {
    names.add(region)
    for (const subRegion of Object.keys(subRegions)) {
      if (subRegion) names.add(subRegion)
    }
  }
  return names
})()

function looksLikeAppellation(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (DESIGNATION_TOKEN_ANYWHERE.test(trimmed)) return true
  return KNOWN_PLACE_NAMES.has(trimmed.toLowerCase())
}

// Flattened set of valid US states, Australian states, and Canadian
// provinces (lowercase) — used to keep a wine region/subregion/appellation
// value from bleeding into the state field.
const VALID_STATES_PROVINCES: Set<string> = new Set(
  ['united states', 'usa', 'us', 'australia', 'canada'].flatMap(
    (country) => COUNTRY_STATE_PAIRS[country] ?? []
  )
)

/**
 * True only for a genuine US state, Australian state, or Canadian
 * province — not a wine region, sub-region, or appellation name that
 * happens to have landed in the state field.
 */
export function looksLikeStateOrProvince(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return VALID_STATES_PROVINCES.has(trimmed.toLowerCase())
}

/**
 * Region -> sub-region (or region-level "") appellation lookup chain.
 * Covers all three population scenarios with one code path: an exact
 * region+subRegion match, a subRegion that isn't in the table (falls back
 * to the region-level entry), and a blank subRegion (same region-level
 * entry, reached directly).
 */
function lookupAppellation(region: string, subRegion: string): string {
  const regionTable = APPELLATION_LOOKUP[region.toLowerCase()]
  if (!regionTable) return ''
  const subRegionKey = subRegion.toLowerCase()
  if (subRegionKey && regionTable[subRegionKey]) return regionTable[subRegionKey]
  return regionTable[''] ?? ''
}

export interface RegionSplitResult {
  region: string
  subRegion: string
  appellation: string
  ambiguous: boolean
}

/**
 * Splits a combined region value, corrects spelling on both halves, infers
 * the official appellation designation, and flags genuinely ambiguous
 * sub-regions (e.g. Carneros, which spans Napa and Sonoma) rather than
 * guessing — ambiguous results are returned with the original raw values
 * untouched so a caller can defer to a human.
 *
 * `country` isn't currently load-bearing in the lookup logic (APPELLATION_LOOKUP
 * and REGION_SUBREGION_PAIRS are keyed by place name, which is unambiguous
 * enough on its own for the regions covered here) but is kept in the
 * signature for future disambiguation and because callers usually have it
 * on hand anyway.
 */
export function normalizeRegionAndSubRegion(
  rawRegion: string | undefined,
  rawSubRegion: string | undefined,
  _country: string | undefined
): RegionSplitResult {
  let region = (rawRegion ?? '').trim()
  let subRegion = (rawSubRegion ?? '').trim()

  // Always clean region if it still holds a combined "Region > SubRegion"
  // value — this can happen even when subRegion is already populated
  // separately (e.g. an import's column-split feature writes a clean
  // subRegion from a raw combined column but leaves the raw combined string
  // in region itself). subRegion is only backfilled from the split when it
  // wasn't already provided — an existing subRegion value is never touched.
  const split = splitCombinedValue(region)
  if (split) {
    region = split.first
    if (!subRegion) {
      subRegion = split.second
    }
  }

  region = normalizeRegionSpelling(cleanFieldValue(region))
  subRegion = normalizeRegionSpelling(cleanFieldValue(subRegion))

  const subRegionKey = subRegion.toLowerCase()
  if (subRegionKey && AMBIGUOUS_SUBREGIONS.has(subRegionKey)) {
    return {
      region: (rawRegion ?? '').trim(),
      subRegion: (rawSubRegion ?? '').trim(),
      appellation: '',
      ambiguous: true,
    }
  }

  if (!region && subRegion) {
    for (const [parent, subs] of Object.entries(REGION_SUBREGION_PAIRS)) {
      if (subs.includes(subRegionKey)) {
        region = normalizeRegionSpelling(parent)
        break
      }
    }
  }

  let appellation = ''
  const suffixMatch = subRegion.match(DESIGNATION_SUFFIX)
  if (suffixMatch) {
    appellation = subRegion
    subRegion = subRegion.slice(0, suffixMatch.index).trim()
  } else {
    appellation = lookupAppellation(region, subRegion)
  }

  return { region, subRegion, appellation, ambiguous: false }
}

const SYMBOL_STRIP_FIELDS: (keyof MappedWineData)[] = [
  'region', 'subRegion', 'varietal', 'classification', 'appellation', 'country', 'state', 'vineyard',
]

/**
 * The single entry point — runs every normalization pass on a mapped wine
 * record and returns the cleaned version. Never throws: any internal
 * failure returns the input unchanged, matching the rest of the
 * enrichment/import pipeline's non-fatal contract.
 */
export function normalizeWineData(wine: Partial<MappedWineData>): Partial<MappedWineData> {
  try {
    const result: Partial<MappedWineData> = { ...wine }

    if (result.varietal) {
      result.varietal = normalizeVarietal(result.varietal)
    }

    const { region, subRegion, appellation, ambiguous } = normalizeRegionAndSubRegion(
      result.region,
      result.subRegion,
      result.country
    )
    if (!ambiguous) {
      if (region) result.region = region
      if (subRegion) result.subRegion = subRegion
      if (appellation && !result.appellation) result.appellation = appellation
    }

    if (result.country) result.country = normalizeRegionSpelling(result.country)
    if (result.state) result.state = normalizeRegionSpelling(result.state)

    if (result.classification) {
      const countryKey = (result.country ?? '').toLowerCase()
      const regionKey = (result.region ?? '').toLowerCase()
      const validTiers = QUALITY_TIER_LOOKUP[countryKey]?.[regionKey]
      // Cleaned (not just trimmed) so a stray leading/trailing separator
      // artifact — e.g. "- Chablis" from an inline edit or import — doesn't
      // fail the exact-match KNOWN_PLACE_NAMES check below and silently
      // stay parked in classification.
      const classificationValue = cleanFieldValue(result.classification)
      const isValidTier = validTiers?.some((tier) => tier.toLowerCase() === classificationValue.toLowerCase())

      if (!isValidTier && looksLikeAppellation(classificationValue)) {
        if (!result.appellation) {
          const remnant = classificationValue.replace(DESIGNATION_TOKEN_ANYWHERE, '').trim()
          result.appellation = remnant
            ? classificationValue
            : lookupAppellation(result.region ?? '', '') || classificationValue
        }
        result.classification = undefined
      }
    }

    for (const field of SYMBOL_STRIP_FIELDS) {
      const value = result[field]
      if (typeof value === 'string') {
        const cleaned = cleanFieldValue(value)
        ;(result as Record<string, unknown>)[field] = cleaned || undefined
      }
    }

    return result
  } catch {
    return wine
  }
}

/**
 * Display-safe region accessor for read paths (table cells, filter option
 * building) that may see data written before normalization existed, or
 * edited inline (which bypasses the import pipeline). Defensively re-splits
 * a value that still contains a combined "Region > SubRegion"-style
 * separator rather than showing it raw.
 */
export function getDisplayRegion(rawRegion: string | null | undefined): string {
  if (!rawRegion) return ''
  const trimmed = rawRegion.trim()
  if (!trimmed) return ''
  const split = splitCombinedValue(trimmed)
  return normalizeRegionSpelling(split ? split.first : trimmed)
}

/**
 * Display-safe sub-region accessor — same defensive re-split as
 * getDisplayRegion, plus designation-suffix stripping (AVA/AOC/DOC/DOCG/
 * DOCa/WO/GI) so a raw, never-normalized value never shows the suffix in a
 * filter dropdown or table cell.
 */
export function getDisplaySubRegion(rawSubRegion: string | null | undefined): string {
  if (!rawSubRegion) return ''
  const trimmed = rawSubRegion.trim()
  if (!trimmed) return ''
  const split = splitCombinedValue(trimmed)
  const base = split ? split.second : trimmed
  const suffixMatch = base.match(DESIGNATION_SUFFIX)
  const stripped = suffixMatch ? base.slice(0, suffixMatch.index).trim() : base
  return normalizeRegionSpelling(stripped)
}
