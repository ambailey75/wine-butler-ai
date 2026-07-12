import type { WineLookupResult } from './types'

const USER_AGENT_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const FETCH_TIMEOUT_MS = 2500

export async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export interface VivinoMatch extends WineLookupResult {
  // Raw Vivino rating, 0-5 scale (vintage.statistics.ratings_average).
  // Left unconverted here — callers scale to their own rating range.
  ratingAverage: number | null
}

// Searches Vivino's public explore endpoint. Best-effort: callers should
// treat failures as "no data" and fall back accordingly, never block on it.
export async function searchVivino(query: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<VivinoMatch[]> {
  const params = new URLSearchParams({
    country_code: 'US',
    currency_code: 'USD',
    grape_filter: 'varietal',
    min_rating: '1',
    order_by: 'ratings_average',
    order: 'desc',
    page: '1',
    price_range_max: '500',
    price_range_min: '0',
    language: 'en',
    q: query,
  })
  for (const id of ['1', '2', '3', '4']) params.append('wine_type_ids[]', id)

  const res = await fetchWithTimeout(
    `https://www.vivino.com/api/explore/explore?${params.toString()}`,
    { 'User-Agent': USER_AGENT_BROWSER, Accept: 'application/json' },
    timeoutMs
  )
  if (!res.ok) throw new Error(`Vivino returned ${res.status}`)

  const data = await res.json()
  const matches: any[] = data?.explore_vintage?.matches ?? []

  return matches
    .slice(0, 6)
    .map((match) => {
      const vintage = match.vintage ?? {}
      const wine = vintage.wine ?? {}
      const statistics = vintage.statistics ?? {}
      const ratingAverage = typeof statistics.ratings_average === 'number' ? statistics.ratings_average : null
      return {
        producer: wine.winery?.name ?? '',
        wineName: wine.name ?? '',
        vintage: typeof vintage.year === 'number' ? vintage.year : null,
        country: wine.region?.country?.name ?? null,
        region: wine.region?.name ?? null,
        varietal: wine.style?.varietal_name ?? null,
        ratingAverage,
      }
    })
    .filter((entry) => entry.producer && entry.wineName)
}
