import { readFileSync } from 'fs'
import { join } from 'path'
import Fuse from 'fuse.js'
import type { MappedWineData } from './constants'
import { ENRICHABLE_FIELDS, type EnrichableField } from './enrichable-fields'

interface StaticEntry {
  producer?: string
  wineName?: string
  country?: string | null
  state?: string | null
  region?: string | null
  subRegion?: string | null
  vineyard?: string | null
  classification?: string | null
  varietal?: string | null
  style?: string | null
}

let cachedFuse: Fuse<StaticEntry> | null = null

function getStaticFuse(): Fuse<StaticEntry> {
  if (cachedFuse) return cachedFuse
  let data: StaticEntry[] = []
  try {
    const raw = readFileSync(join(process.cwd(), 'public', 'wine-data.json'), 'utf-8')
    data = JSON.parse(raw) as StaticEntry[]
  } catch {
    data = []
  }
  cachedFuse = new Fuse(data, {
    keys: [
      { name: 'producer', weight: 0.6 },
      { name: 'wineName', weight: 0.4 },
    ],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
  })
  return cachedFuse
}

export type EnrichableRow = {
  mappedData: MappedWineData
  confidenceScores: Record<string, unknown>
}

export function enrichFromStaticDataset(
  rows: EnrichableRow[],
  fields: readonly EnrichableField[] = ENRICHABLE_FIELDS
): EnrichableRow[] {
  const fuse = getStaticFuse()

  return rows.map(({ mappedData, confidenceScores }) => {
    const query = [mappedData.producer, mappedData.wineName].filter(Boolean).join(' ')
    if (query.trim().length < 3) return { mappedData, confidenceScores }

    const results = fuse.search(query, { limit: 1 })
    if (!results.length) return { mappedData, confidenceScores }

    // Fuse score: 0 = perfect match, 1 = no match. Invert for confidence.
    const confidence = 1 - (results[0].score ?? 1)
    if (confidence < 0.7) return { mappedData, confidenceScores }

    const match = results[0].item
    const newData = { ...mappedData }
    const newScores: Record<string, unknown> = { ...confidenceScores }

    for (const field of fields) {
      if (mappedData[field as keyof MappedWineData]) continue
      const matchVal = match[field as keyof StaticEntry]
      if (!matchVal) continue
      ;(newData as Record<string, unknown>)[field] = matchVal
      newScores[field] = 0.85
      newScores[`_src_${field}`] = 'static'
    }

    return { mappedData: newData, confidenceScores: newScores }
  })
}
