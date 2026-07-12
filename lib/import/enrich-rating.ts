import { anthropic, CLAUDE_MODEL } from '@/lib/ai/client'
import { searchVivino, type VivinoMatch } from '@/lib/wines/vivino'
import type { EnrichableRow } from './enrich-from-static'

const VIVINO_TIMEOUT_MS = 2000
const VIVINO_CONCURRENCY = 5
// Vivino requires one live HTTP request per wine (unlike the batched Claude
// call below). Past this many rows needing a rating in a single run, skip
// Vivino entirely and go straight to the batched Claude fallback so a large
// import can't blow the confirm route's request time budget.
const MAX_VIVINO_LOOKUPS = 40

function normalize(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase()
}

function pickBestMatch(
  matches: VivinoMatch[],
  producer: string | undefined,
  wineName: string | undefined,
  vintage: number | undefined
): VivinoMatch | null {
  const nProducer = normalize(producer)
  const nWineName = normalize(wineName)
  if (!nProducer || !nWineName) return null

  let best: VivinoMatch | null = null
  let bestScore = -1
  for (const match of matches) {
    if (match.ratingAverage == null) continue
    const producerMatch = normalize(match.producer).includes(nProducer) || nProducer.includes(normalize(match.producer))
    const wineNameMatch = normalize(match.wineName).includes(nWineName) || nWineName.includes(normalize(match.wineName))
    if (!producerMatch || !wineNameMatch) continue
    const vintageMatch = vintage != null && match.vintage === vintage
    const score = (producerMatch ? 1 : 0) + (wineNameMatch ? 1 : 0) + (vintageMatch ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = match
    }
  }
  return bestScore >= 2 ? best : null
}

async function lookupVivinoRating(
  producer: string | undefined,
  wineName: string | undefined,
  vintage: number | undefined
): Promise<number | null> {
  const query = [producer, wineName, vintage].filter(Boolean).join(' ')
  if (!query.trim()) return null

  try {
    const matches = await searchVivino(query, VIVINO_TIMEOUT_MS)
    const best = pickBestMatch(matches, producer, wineName, vintage)
    if (!best || best.ratingAverage == null) return null
    // Vivino is 0-5 (one decimal); this app's rating scale is 0-100.
    return Math.round(best.ratingAverage * 20 * 10) / 10
  } catch {
    return null
  }
}

async function claudeEstimateRatings(
  rows: Array<{ index: number; row: EnrichableRow }>
): Promise<Map<number, number>> {
  if (rows.length === 0) return new Map()

  try {
    const payload = rows.map(({ index, row }) => ({
      index,
      producer: row.mappedData.producer,
      wineName: row.mappedData.wineName,
      vintage: row.mappedData.vintage,
      region: row.mappedData.region,
      varietal: row.mappedData.varietal,
    }))

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system:
        'You are a wine expert. For each wine, give your best-estimate critic score on a 0-100 scale, ' +
        'based on typical quality/reputation for that producer, wine, region, and vintage. ' +
        'Return ONLY a JSON array, one element per wine you can reasonably estimate: {"index":<number>,"rating":<0-100>}. ' +
        'Omit a wine entirely if you have no reasonable basis to estimate it — never invent a number with no grounding.',
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })

    const text = response.content.find((c) => c.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return new Map()

    const parsed = JSON.parse(jsonMatch[0]) as { index: number; rating: number }[]
    const result = new Map<number, number>()
    for (const { index, rating } of parsed) {
      if (typeof rating === 'number' && rating >= 0 && rating <= 100) {
        result.set(index, rating)
      }
    }
    return result
  } catch {
    return new Map()
  }
}

// Vivino-then-Claude cascade for the one enrichable field that can't come
// from the curated static dataset. Never throws — any failure at any stage
// just leaves that row's rating blank. Every filled rating is tagged with a
// _src_rating marker so the UI can show where it came from (Vivino vs AI
// estimate) — a rating is never shown without that source badge.
export async function enrichRatings(rows: EnrichableRow[]): Promise<EnrichableRow[]> {
  const blankIndexes = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.mappedData.rating)

  if (blankIndexes.length === 0) return rows

  const result: EnrichableRow[] = rows.map((row) => ({
    mappedData: { ...row.mappedData },
    confidenceScores: { ...row.confidenceScores },
  }))

  const vivinoCandidates = blankIndexes.slice(0, MAX_VIVINO_LOOKUPS)
  const stillBlank: Array<{ index: number; row: EnrichableRow }> = blankIndexes
    .slice(MAX_VIVINO_LOOKUPS)
    .map(({ row, index }) => ({ index, row }))

  for (let i = 0; i < vivinoCandidates.length; i += VIVINO_CONCURRENCY) {
    const chunk = vivinoCandidates.slice(i, i + VIVINO_CONCURRENCY)
    const outcomes = await Promise.allSettled(
      chunk.map(({ row }) =>
        lookupVivinoRating(row.mappedData.producer, row.mappedData.wineName, row.mappedData.vintage)
      )
    )

    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j]
      const { index, row } = chunk[j]
      if (outcome.status === 'fulfilled' && outcome.value != null) {
        result[index].mappedData.rating = outcome.value
        result[index].confidenceScores.rating = 0.8
        result[index].confidenceScores._src_rating = 'vivino'
      } else {
        stillBlank.push({ index, row })
      }
    }
  }

  if (stillBlank.length > 0) {
    const estimates = await claudeEstimateRatings(stillBlank)
    for (const { index } of stillBlank) {
      const estimate = estimates.get(index)
      if (estimate == null) continue
      result[index].mappedData.rating = Math.round(estimate * 10) / 10
      result[index].confidenceScores.rating = 0.6
      result[index].confidenceScores._src_rating = 'ai-estimate'
    }
  }

  return result
}
