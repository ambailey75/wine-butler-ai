import type { MappedWineData } from './constants'

// Single source of truth for which MappedWineData fields enrichment is
// allowed to fill. Previously duplicated verbatim in enrich-from-static.ts
// and enrich-from-claude.ts — consolidated here so the two can't diverge.
export const ENRICHABLE_FIELDS = [
  'country', 'state', 'region', 'subRegion', 'varietal',
  'style', 'drinkWindowStart', 'drinkWindowEnd', 'classification', 'vineyard',
] as const

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

// Layer 2/3 (pre-confirm, post-confirm) only — rating is deliberately
// excluded from Layer 1 (pre-review) since it can only come from Vivino or
// Claude's own recall, never the curated static dataset, and needs its own
// confidence/badge treatment (see lib/import/enrich-rating.ts).
export const CONFIRM_ENRICHABLE_FIELDS: readonly (EnrichableField | 'rating')[] = [
  ...ENRICHABLE_FIELDS,
  'rating',
]

export type ConfirmEnrichableField = (typeof CONFIRM_ENRICHABLE_FIELDS)[number]

export const NUMERIC_ENRICHABLE_FIELDS = new Set<EnrichableField | 'rating'>([
  'drinkWindowStart', 'drinkWindowEnd', 'rating',
])

export function getBlankFields<F extends string>(
  data: MappedWineData,
  fields: readonly F[]
): F[] {
  return fields.filter((f) => !data[f as keyof MappedWineData])
}
