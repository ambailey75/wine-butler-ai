import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron/auth'
import { prisma } from '@/lib/prisma/client'
import { runEnrichment } from '@/lib/import/run-enrichment'
import { CONFIRM_ENRICHABLE_FIELDS } from '@/lib/import/enrichable-fields'
import { normalizeWineData } from '@/lib/wines/normalize'
import type { EnrichableRow } from '@/lib/import/enrich-from-static'

// Permanent replacement for the old confirm-route "Layer 3" (a detached
// setImmediate promise, unreliable on Vercel — the function can freeze
// shortly after the response flushes). Runs nightly, sweeps any wine
// created or updated recently, and fills whatever enrichable fields are
// still blank. See vercel.json for the schedule.
export const maxDuration = 60

const LOOKBACK_HOURS = 48
const BATCH_SIZE = 25

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000)

  const wines = await prisma.wine.findMany({
    where: {
      OR: [{ createdAt: { gte: cutoff } }, { updatedAt: { gte: cutoff } }],
    },
  })

  let processed = 0
  let fieldsFilled = 0
  let failed = 0

  for (let i = 0; i < wines.length; i += BATCH_SIZE) {
    const batch = wines.slice(i, i + BATCH_SIZE)

    const rows: EnrichableRow[] = batch.map((w) => ({
      mappedData: {
        country: w.country ?? undefined,
        state: w.state ?? undefined,
        region: w.region ?? undefined,
        subRegion: w.subRegion ?? undefined,
        appellation: w.appellation ?? undefined,
        vineyard: w.vineyard ?? undefined,
        classification: w.classification ?? undefined,
        varietal: w.varietal ?? undefined,
        style: w.style ?? undefined,
        drinkWindowStart: w.drinkWindowStart ?? undefined,
        drinkWindowEnd: w.drinkWindowEnd ?? undefined,
        rating: w.rating ? w.rating.toNumber() : undefined,
      },
      confidenceScores: {},
    }))

    const normalized = rows.map((row) => ({
      mappedData: normalizeWineData(row.mappedData),
      confidenceScores: row.confidenceScores,
    }))
    const enriched = await runEnrichment(normalized, { layer: 'post-confirm', fields: CONFIRM_ENRICHABLE_FIELDS })

    const results = await Promise.allSettled(
      enriched.map(async (row, idx) => {
        const wine = batch[idx]
        const data: Record<string, unknown> = {}

        for (const field of [...CONFIRM_ENRICHABLE_FIELDS, 'appellation'] as const) {
          const value = (row.mappedData as Record<string, unknown>)[field]
          const current = (wine as Record<string, unknown>)[field]
          if (value != null && value !== '' && (current == null || current === '')) {
            data[field] = value
          }
        }

        if (Object.keys(data).length === 0) return 0

        await prisma.wine.update({ where: { id: wine.id }, data })
        return Object.keys(data).length
      })
    )

    for (const result of results) {
      processed++
      if (result.status === 'fulfilled') {
        fieldsFilled += result.value
      } else {
        failed++
        console.error('[cron enrich-new-wines] failed to enrich a wine:', result.reason)
      }
    }
  }

  console.log(`[cron enrich-new-wines] processed=${processed} fieldsFilled=${fieldsFilled} failed=${failed}`)

  return NextResponse.json({ processed, fieldsFilled, failed })
}
