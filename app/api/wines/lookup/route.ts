import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import type { WineLookupResult } from '@/lib/wines/types'
import { fetchWithTimeout, searchVivino } from '@/lib/wines/vivino'

const USER_AGENT_OFF = 'WineButlerAI/1.0 (winebutlerai.com; contact: ambailey91406@gmail.com)'

async function searchOpenFoodFacts(query: string): Promise<WineLookupResult[]> {
  const params = new URLSearchParams({
    search_terms: query,
    tagtype_0: 'categories',
    tag_contains_0: 'contains',
    tag_0: 'wines',
    json: '1',
    page_size: '6',
  })

  const res = await fetchWithTimeout(`https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`, {
    'User-Agent': USER_AGENT_OFF,
  })
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`)

  const data = await res.json()
  const products: any[] = data?.products ?? []

  return products
    .slice(0, 6)
    .map((product) => {
      const rawName: string = product.product_name ?? ''
      const yearMatch = rawName.match(/^(19|20)\d{2}\b/)
      const vintage = yearMatch ? parseInt(yearMatch[0], 10) : null
      const wineName = yearMatch ? rawName.slice(yearMatch[0].length).trim() : rawName
      const producer = (product.brands ?? '').split(',')[0]?.trim() ?? ''
      const country = (product.countries ?? '').split(',')[0]?.trim() || null

      return {
        producer,
        wineName,
        vintage,
        country,
        region: null,
        varietal: null,
      }
    })
    .filter((entry) => entry.producer && entry.wineName)
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (query.length < 2) {
    return NextResponse.json([])
  }

  try {
    const results = await searchVivino(query)
    if (results.length > 0) {
      return NextResponse.json(results)
    }
  } catch {
    // fall through to Open Food Facts
  }

  try {
    const results = await searchOpenFoodFacts(query)
    return NextResponse.json(results)
  } catch {
    return NextResponse.json([])
  }
}
