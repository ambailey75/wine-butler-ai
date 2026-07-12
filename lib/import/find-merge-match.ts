import { prisma } from '@/lib/prisma/client'
import type { MappedWineData } from './constants'

export interface ExistingWineSnapshot {
  quantity: number
  consumedQuantity: number
  isFullyConsumed: boolean
  storageLocation: string | null
  country: string | null
  state: string | null
  region: string | null
  subRegion: string | null
  vineyard: string | null
  classification: string | null
  varietal: string | null
  style: string | null
  format: string | null
  vendor: string | null
  purchasePrice: number | null
  purchaseDate: Date | null
  currentEstValue: number | null
  totalCostOverride: number | null
  totalValueOverride: number | null
  rating: number | null
  drinkWindowStart: number | null
  drinkWindowEnd: number | null
  tastingNotes: string | null
  pairingNotes: string | null
}

export type MergeOutcome =
  | { type: 'new' }
  | { type: 'merge'; wineId: string; label: string; existing: ExistingWineSnapshot }
  | {
      type: 'needs-decision'
      wineId: string
      label: string
      existing: ExistingWineSnapshot
      importedLocation: string
    }

function normalize(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase()
}

// Identity key ignoring storageLocation — used to find the wine-identity
// candidate before deciding how storageLocation affects the outcome.
function buildIdentityKey(
  producer?: string | null,
  wineName?: string | null,
  vintage?: number | null,
  format?: string | null
): string {
  return [normalize(producer), normalize(wineName), vintage ?? '', normalize(format)].join('|')
}

interface ExistingWineRow {
  id: string
  producer: string
  wineName: string
  vintage: number | null
  format: string | null
  storageLocation: string | null
  quantity: number
  consumedQuantity: number
  isFullyConsumed: boolean
  country: string | null
  state: string | null
  region: string | null
  subRegion: string | null
  vineyard: string | null
  classification: string | null
  varietal: string | null
  style: string | null
  vendor: string | null
  purchasePrice: { toNumber(): number } | null
  purchaseDate: Date | null
  currentEstValue: { toNumber(): number } | null
  totalCostOverride: { toNumber(): number } | null
  totalValueOverride: { toNumber(): number } | null
  rating: { toNumber(): number } | null
  drinkWindowStart: number | null
  drinkWindowEnd: number | null
  tastingNotes: string | null
  pairingNotes: string | null
}

function toSnapshot(wine: ExistingWineRow): ExistingWineSnapshot {
  return {
    quantity: wine.quantity,
    consumedQuantity: wine.consumedQuantity,
    isFullyConsumed: wine.isFullyConsumed,
    storageLocation: wine.storageLocation,
    country: wine.country,
    state: wine.state,
    region: wine.region,
    subRegion: wine.subRegion,
    vineyard: wine.vineyard,
    classification: wine.classification,
    varietal: wine.varietal,
    style: wine.style,
    format: wine.format,
    vendor: wine.vendor,
    purchasePrice: wine.purchasePrice ? wine.purchasePrice.toNumber() : null,
    purchaseDate: wine.purchaseDate,
    currentEstValue: wine.currentEstValue ? wine.currentEstValue.toNumber() : null,
    totalCostOverride: wine.totalCostOverride ? wine.totalCostOverride.toNumber() : null,
    totalValueOverride: wine.totalValueOverride ? wine.totalValueOverride.toNumber() : null,
    rating: wine.rating ? wine.rating.toNumber() : null,
    drinkWindowStart: wine.drinkWindowStart,
    drinkWindowEnd: wine.drinkWindowEnd,
    tastingNotes: wine.tastingNotes,
    pairingNotes: wine.pairingNotes,
  }
}

function label(wine: ExistingWineRow): string {
  return `${wine.producer} ${wine.wineName}${wine.vintage ? ` (${wine.vintage})` : ''}`
}

// The single match function used by both the review-page preview and the
// confirm-time authoritative merge decision, so the two can never disagree.
//
// Three outcomes per candidate:
// - 'new': no existing wine shares producer+wineName+vintage+format.
// - 'merge': identity matches AND storageLocation matches (including both
//   blank, or existing has a value and the import doesn't specify one).
// - 'needs-decision': identity matches, but the existing wine has no
//   storageLocation while the import does — auto-merging would silently
//   assign a location the user never confirmed, so this is flagged instead.
// Identity matches with two different non-blank storage locations fall
// through to 'new' — same as today's exact-duplicate behavior, distinct
// physical records are intentionally not merged.
export async function findMergeMatches(
  userId: string,
  candidates: MappedWineData[]
): Promise<MergeOutcome[]> {
  const existingWines = await prisma.wine.findMany({
    where: { userId },
    select: {
      id: true,
      producer: true,
      wineName: true,
      vintage: true,
      format: true,
      storageLocation: true,
      quantity: true,
      consumedQuantity: true,
      isFullyConsumed: true,
      country: true,
      state: true,
      region: true,
      subRegion: true,
      vineyard: true,
      classification: true,
      varietal: true,
      style: true,
      vendor: true,
      purchasePrice: true,
      purchaseDate: true,
      currentEstValue: true,
      totalCostOverride: true,
      totalValueOverride: true,
      rating: true,
      drinkWindowStart: true,
      drinkWindowEnd: true,
      tastingNotes: true,
      pairingNotes: true,
    },
  })

  const lookup = new Map<string, ExistingWineRow>()
  for (const wine of existingWines) {
    const key = buildIdentityKey(wine.producer, wine.wineName, wine.vintage, wine.format)
    if (!lookup.has(key)) {
      lookup.set(key, wine)
    }
  }

  return candidates.map((candidate) => {
    const key = buildIdentityKey(candidate.producer, candidate.wineName, candidate.vintage, candidate.format)
    const existing = lookup.get(key)
    if (!existing) return { type: 'new' }

    const existingLocation = normalize(existing.storageLocation)
    const importedLocation = normalize(candidate.storageLocation)

    if (!existingLocation && importedLocation) {
      return {
        type: 'needs-decision',
        wineId: existing.id,
        label: label(existing),
        existing: toSnapshot(existing),
        importedLocation: candidate.storageLocation!.trim(),
      }
    }

    if (existingLocation && importedLocation && existingLocation !== importedLocation) {
      return { type: 'new' }
    }

    return { type: 'merge', wineId: existing.id, label: label(existing), existing: toSnapshot(existing) }
  })
}
