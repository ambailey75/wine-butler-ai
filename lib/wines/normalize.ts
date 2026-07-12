import type { MappedWineData } from '@/lib/import/constants'
import { cleanFieldValue } from '@/lib/import/clean-field-values'
import { VARIETAL_MAP, PROTECTED_BLEND_NAMES } from './varietal-data'
import { REGION_SUBREGION_PAIRS, REGION_SPELLING_CORRECTIONS, KNOWN_APPELLATIONS, AMBIGUOUS_SUBREGIONS } from './region-data'

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

function splitCombinedValue(value: string): { first: string; second: string } | null {
  for (const sep of REGION_SPLIT_SEPARATORS) {
    const idx = value.indexOf(sep)
    if (idx > -1) {
      return { first: value.slice(0, idx).trim(), second: value.slice(idx + sep.length).trim() }
    }
  }
  return null
}

export interface RegionSplitResult {
  region: string
  subRegion: string
  appellation: string
  ambiguous: boolean
}

/**
 * Splits a combined region value, corrects spelling on both halves, infers
 * a known legal appellation designation from the resulting sub-region, and
 * flags genuinely ambiguous sub-regions (e.g. Carneros, which spans Napa and
 * Sonoma) rather than guessing — ambiguous results are returned with the
 * original raw values untouched so a caller can defer to a human.
 *
 * `country` isn't currently load-bearing in the lookup logic (KNOWN_APPELLATIONS
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

  if (!subRegion && region) {
    const split = splitCombinedValue(region)
    if (split) {
      region = split.first
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

  const appellation = subRegionKey ? KNOWN_APPELLATIONS[subRegionKey] ?? '' : ''

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
