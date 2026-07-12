import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth/current-user'
import { prisma } from '@/lib/prisma/client'
import { applyColumnMapping } from '@/lib/import/excel'
import { splitRegionValue, splitCountryStateValue } from '@/lib/import/claude-extractor'
import type { MappedWineData } from '@/lib/import/constants'
import { runEnrichment } from '@/lib/import/run-enrichment'
import type { EnrichableRow } from '@/lib/import/enrich-from-static'

// ENRICHMENT REQUIREMENT: this is the Layer 1 (pre-review) enrichment site
// for spreadsheet imports — mappedData doesn't exist until this route runs,
// so it can't be enriched any earlier in the pipeline. Every import path
// must call runEnrichment() before the review table is shown. Do not write
// mappedData to the database from this route without it. See
// lib/import/run-enrichment.ts.

export const maxDuration = 60

interface RouteParams {
  params: { id: string }
}

const BATCH_SIZE = 100

export async function POST(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const importRecord = await prisma.import.findFirst({
    where: { id: params.id, userId: user.id },
    include: { rows: true },
  })
  if (!importRecord) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const mapping = body?.mapping
  if (!mapping || typeof mapping !== 'object') {
    return NextResponse.json({ error: 'mapping is required' }, { status: 400 })
  }

  const regionSplits: Record<string, string> = body?.regionSplits ?? {}
  const countryStateSplits: Record<string, string> = body?.countryStateSplits ?? {}

  try {
    // Phase A — map (sync, CPU-only): compute mappedData/confidenceScores
    // for every row without writing to the database yet.
    const mapped = importRecord.rows.map((row) => {
      const rawData = (row.rawData ?? {}) as unknown as Record<string, string>
      const { mappedData, confidenceScores } = applyColumnMapping(rawData, mapping)

      for (const [header, separator] of Object.entries(regionSplits)) {
        const rawValue = rawData[header]?.trim()
        if (!rawValue) continue
        const { region, subRegion } = splitRegionValue(rawValue, separator)
        const typed = mappedData as MappedWineData
        typed.region = region
        if (subRegion) {
          typed.subRegion = subRegion
        }
      }

      for (const [header, separator] of Object.entries(countryStateSplits)) {
        const rawValue = rawData[header]?.trim()
        if (!rawValue) continue
        const { country, state } = splitCountryStateValue(rawValue, separator)
        const typed = mappedData as MappedWineData
        typed.country = country
        if (state) {
          typed.state = state
        }
      }

      return { rowId: row.id, mappedData: mappedData as MappedWineData, confidenceScores }
    })

    // Phase B — enrich (once for the whole import, not per-row).
    const enrichableRows: EnrichableRow[] = mapped.map((r) => ({
      mappedData: r.mappedData,
      confidenceScores: r.confidenceScores as unknown as Record<string, unknown>,
    }))
    const enriched = await runEnrichment(enrichableRows, { layer: 'pre-review' })

    // Phase C — save, batched.
    for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
      const batch = mapped.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map((row, idx) =>
          prisma.importRow.update({
            where: { id: row.rowId },
            data: {
              mappedData: enriched[i + idx].mappedData as unknown as Prisma.InputJsonValue,
              confidenceScores: enriched[i + idx].confidenceScores as unknown as Prisma.InputJsonValue,
            },
          })
        )
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not apply mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
