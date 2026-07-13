import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getCurrentUser } from '@/lib/auth/current-user'
import { prisma } from '@/lib/prisma/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { getImport } from '@/lib/import/queries'
import { IMPORTS_BUCKET, LABELS_BUCKET, type MappedWineData } from '@/lib/import/constants'
import { inferStyle } from '@/lib/wines/inferStyle'
import { runEnrichment } from '@/lib/import/run-enrichment'
import { CONFIRM_ENRICHABLE_FIELDS } from '@/lib/import/enrichable-fields'
import { findMergeMatches, type MergeOutcome, type ExistingWineSnapshot } from '@/lib/import/find-merge-match'
import type { EnrichableRow } from '@/lib/import/enrich-from-static'
import { normalizeWineData, looksLikeStateOrProvince } from '@/lib/wines/normalize'

// ENRICHMENT REQUIREMENT: this route is Layer 2 (pre-confirm safety net) —
// every row must be run through normalizeWineData() and runEnrichment()
// before a Wine record is created or updated. See
// lib/import/run-enrichment.ts and lib/wines/normalize.ts. Layer 3
// (post-confirm background enrichment) is a nightly cron job, not run from
// here — see app/api/cron/enrich-new-wines/route.ts. This route also owns
// reconciliation (lib/import/find-merge-match.ts): a row matching an
// existing cellar wine must merge into it (add quantity, fill blanks)
// rather than create a duplicate Wine row.

export const maxDuration = 60

interface RouteParams {
  params: { id: string }
}

const BATCH_SIZE = 50

// Fields backed by a Decimal or Int column that can trip a Postgres numeric
// overflow (22003) if a bad extraction slips an out-of-range value through.
// Ordered with the most common offender (rating) first since Fallback 1
// retries by nulling one of these at a time until the insert succeeds.
const OPTIONAL_NUMERIC_FIELDS = [
  'rating',
  'purchasePrice',
  'currentEstValue',
  'totalCostOverride',
  'totalValueOverride',
  'drinkWindowStart',
  'drinkWindowEnd',
  'vintage',
] as const

// Subset of the merge blank-fill diff that's Decimal/Int-backed and so can
// hit the same 22003 overflow on an update.
const MERGE_OPTIONAL_NUMERIC_FIELDS = ['rating', 'purchasePrice', 'currentEstValue', 'drinkWindowStart', 'drinkWindowEnd'] as const

function isNumericOverflowError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /22003|numeric field overflow/i.test(message)
}

function appendNote(existing: string | null | undefined, note: string): string {
  return existing && existing.trim() ? `${existing.trim()}\n${note}` : note
}

// Pre-insert clamping for the known overflow cases (e.g. a rating extracted
// as "940" instead of "94.0") so most rows never need the fallback cascade.
function clampNumericFields(mapped: MappedWineData): MappedWineData {
  const result: MappedWineData = { ...mapped }

  if (typeof result.rating === 'number') {
    const scaled = result.rating > 100 ? result.rating / 10 : result.rating
    result.rating = scaled >= 0 && scaled <= 100 ? scaled : undefined
  }

  for (const key of ['purchasePrice', 'currentEstValue'] as const) {
    const value = result[key]
    if (typeof value === 'number' && (value < 0 || value > 100000)) {
      result[key] = undefined
    }
  }

  if (typeof result.vintage === 'number' && (result.vintage < 1800 || result.vintage > 2030)) {
    result.vintage = undefined
  }

  for (const key of ['drinkWindowStart', 'drinkWindowEnd'] as const) {
    const value = result[key]
    if (typeof value === 'number' && (value < 1800 || value > 2100)) {
      result[key] = undefined
    }
  }

  if (typeof result.quantity !== 'number' || result.quantity < 1 || result.quantity > 999) {
    result.quantity = 1
  }

  return result
}

function toWineCreateData(mapped: MappedWineData) {
  const purchaseDate = mapped.purchaseDate ? new Date(mapped.purchaseDate) : null

  return {
    producer: mapped.producer?.trim() || 'Unknown',
    wineName: mapped.wineName?.trim() || 'Unknown Wine',
    vintage: mapped.vintage ?? null,
    country: mapped.country ?? null,
    state: mapped.state && looksLikeStateOrProvince(mapped.state) ? mapped.state : null,
    region: mapped.region ?? null,
    subRegion: mapped.subRegion ?? null,
    appellation: mapped.appellation ?? null,
    vineyard: mapped.vineyard ?? null,
    classification: mapped.classification ?? null,
    varietal: mapped.varietal ?? null,
    format: mapped.format ?? null,
    style: mapped.style || inferStyle({ varietal: mapped.varietal, region: mapped.region, wineName: mapped.wineName, classification: mapped.classification }) || null,
    quantity: mapped.quantity && mapped.quantity > 0 ? Math.round(mapped.quantity) : 1,
    purchasePrice: mapped.purchasePrice ?? null,
    purchaseDate: purchaseDate && !Number.isNaN(purchaseDate.getTime()) ? purchaseDate : null,
    vendor: mapped.vendor ?? null,
    storageLocation: mapped.storageLocation ?? null,
    notes: mapped.notes ?? null,
    currentEstValue: mapped.currentEstValue ?? null,
    totalCostOverride: mapped.totalCostOverride ?? null,
    totalValueOverride: mapped.totalValueOverride ?? null,
    rating: mapped.rating ?? null,
    drinkWindowStart: mapped.drinkWindowStart ?? null,
    drinkWindowEnd: mapped.drinkWindowEnd ?? null,
    tastingNotes: mapped.tastingNotes ?? null,
    pairingNotes: mapped.pairingNotes ?? null,
    wineId: mapped.wineId ?? null,
  }
}

type WineCreateData = ReturnType<typeof toWineCreateData> & {
  userId: string
  importId: string
  labelPhotoUrl?: string
  isFullyConsumed?: boolean
  consumedQuantity?: number
}

// Every row must land in the cellar — a numeric overflow should never cause a
// row to be dropped or silently marked Skipped. Retries with progressively
// more data stripped out until an insert succeeds; only the true last resort
// (producer/wineName/quantity only) is allowed to fail upward.
async function createWineWithFallback(
  data: WineCreateData,
  mapped: MappedWineData
): Promise<{
  wine: { id: string; notes: string | null; vintage: number | null; producer: string; wineName: string }
  note: string | null
}> {
  try {
    const wine = await prisma.wine.create({ data })
    return { wine, note: null }
  } catch (err) {
    if (!isNumericOverflowError(err)) throw err
  }

  // Fallback 1 — null out one numeric field at a time (most likely culprit first) and retry.
  for (const field of OPTIONAL_NUMERIC_FIELDS) {
    if ((data as Record<string, unknown>)[field] == null) continue
    try {
      const retryData = { ...data, [field]: null }
      const wine = await prisma.wine.create({ data: retryData })
      return { wine, note: `Field ${field} was cleared due to a value error` }
    } catch (err) {
      if (!isNumericOverflowError(err)) throw err
    }
  }

  // Fallback 2 — strip every optional numeric field at once and retry.
  try {
    const stripped: Record<string, unknown> = { ...data }
    for (const field of OPTIONAL_NUMERIC_FIELDS) {
      stripped[field] = null
    }
    const wine = await prisma.wine.create({ data: stripped as WineCreateData })
    return {
      wine,
      note: 'All numeric fields cleared due to value errors — please update manually in your cellar',
    }
  } catch (err) {
    if (!isNumericOverflowError(err)) throw err
  }

  // Fallback 3 — last resort minimum record. producer/wineName/quantity are
  // plain string/int values so this cannot itself hit a numeric overflow.
  const wine = await prisma.wine.create({
    data: {
      userId: data.userId,
      importId: data.importId,
      producer: mapped.producer?.trim() || 'Unknown',
      wineName: mapped.wineName?.trim() || 'Unknown Wine',
      quantity: 1,
    },
  })
  return {
    wine,
    note: 'Only producer, wine name, and quantity were imported due to repeated value errors — please update manually in your cellar',
  }
}

// Builds the blank-fill diff for a merge: only fields that are null/blank on
// the existing wine get set, from the (already-enriched) imported row.
// Existing non-null values are never overwritten. storageLocation is set
// explicitly when the caller resolved a 'needs-decision' row to merge
// (setLocation), otherwise it follows the same blank-fill rule as everything
// else. Wine.notes is deliberately excluded — reserved for the fallback note.
function buildMergeDiff(
  existing: ExistingWineSnapshot,
  mapped: MappedWineData,
  setLocation?: string
): Record<string, unknown> {
  const diff: Record<string, unknown> = {}

  const fillIfBlank = (key: keyof ExistingWineSnapshot, value: unknown) => {
    const current = existing[key]
    const isBlank = current == null || current === ''
    if (isBlank && value != null && value !== '') {
      diff[key] = value
    }
  }

  fillIfBlank('country', mapped.country)
  fillIfBlank('state', mapped.state)
  fillIfBlank('region', mapped.region)
  fillIfBlank('subRegion', mapped.subRegion)
  fillIfBlank('vineyard', mapped.vineyard)
  fillIfBlank('classification', mapped.classification)
  fillIfBlank('varietal', mapped.varietal)
  fillIfBlank('style', mapped.style)
  fillIfBlank('rating', mapped.rating)
  fillIfBlank('drinkWindowStart', mapped.drinkWindowStart)
  fillIfBlank('drinkWindowEnd', mapped.drinkWindowEnd)
  fillIfBlank('tastingNotes', mapped.tastingNotes)
  fillIfBlank('pairingNotes', mapped.pairingNotes)
  fillIfBlank('purchasePrice', mapped.purchasePrice)
  fillIfBlank('currentEstValue', mapped.currentEstValue)
  fillIfBlank('vendor', mapped.vendor)

  if (mapped.purchaseDate) {
    const parsed = new Date(mapped.purchaseDate)
    if (!Number.isNaN(parsed.getTime())) {
      fillIfBlank('purchaseDate', parsed)
    }
  }

  if (setLocation) {
    diff.storageLocation = setLocation
  } else {
    fillIfBlank('storageLocation', mapped.storageLocation)
  }

  return diff
}

interface MergeResult {
  wineId: string
  quantityAdded: number
}

interface MergeTarget {
  wineId: string
  existing: ExistingWineSnapshot
}

// Merges an imported row into an existing wine: adds quantity, fills blanks,
// never overwrites. On a numeric overflow, drops the optional numeric fields
// from the diff and retries — the quantity/text fields always land even if
// a bad numeric value has to be dropped. Never marks the row Skipped.
// Accepts both the 'merge' and 'needs-decision' (resolved-to-merge) outcome
// shapes — both carry wineId/existing, only needs-decision has an
// importedLocation the caller may pass through as setLocation.
async function mergeIntoExistingWine(
  target: MergeTarget,
  mapped: MappedWineData,
  quantityToAdd: number,
  isConsumed: boolean,
  setLocation?: string
): Promise<MergeResult> {
  const diff = buildMergeDiff(target.existing, mapped, setLocation)
  const newQuantity = target.existing.quantity + quantityToAdd

  const data: Record<string, unknown> = { quantity: newQuantity, ...diff }

  if (isConsumed) {
    const newConsumedQuantity = target.existing.consumedQuantity + quantityToAdd
    data.consumedQuantity = newConsumedQuantity
    data.isFullyConsumed = newConsumedQuantity >= newQuantity
  }

  try {
    await prisma.wine.update({ where: { id: target.wineId }, data })
  } catch (err) {
    if (!isNumericOverflowError(err)) throw err
    for (const field of MERGE_OPTIONAL_NUMERIC_FIELDS) {
      delete data[field]
    }
    await prisma.wine.update({ where: { id: target.wineId }, data })
  }

  return { wineId: target.wineId, quantityAdded: quantityToAdd }
}

async function copyLabelPhoto(userId: string, sourcePath: string): Promise<string | null> {
  const supabase = createAdminClient()

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(IMPORTS_BUCKET)
    .download(sourcePath)

  if (downloadError || !fileData) return null

  const ext = sourcePath.split('.').pop()?.toLowerCase() || 'jpg'
  const labelPath = `${userId}/${Date.now()}.${ext}`

  let { error: uploadError } = await supabase.storage.from(LABELS_BUCKET).upload(labelPath, fileData, {
    contentType: fileData.type,
    upsert: true,
  })

  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    await supabase.storage.createBucket(LABELS_BUCKET, { public: true })
    uploadError = (
      await supabase.storage.from(LABELS_BUCKET).upload(labelPath, fileData, {
        contentType: fileData.type,
        upsert: true,
      })
    ).error
  }

  if (uploadError) return null

  const { data } = supabase.storage.from(LABELS_BUCKET).getPublicUrl(labelPath)
  return data.publicUrl
}

export async function POST(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const importRecord = await getImport(user.id, params.id)
  if (!importRecord) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (importRecord.status !== 'REVIEW') {
    return NextResponse.json({ error: 'This import is not ready to confirm' }, { status: 400 })
  }

  // ─── Match-consumed confirmation (separate non-streaming flow) ───────────────
  if (importRecord.importType === 'MATCH_CONSUMED') {
    const body = await request.json().catch(() => ({}))
    const matchActions: Array<{
      importRowId: string
      matchedWineId: string | null
      action: 'consume' | 'add_new' | 'skip'
    }> = body.matchActions ?? []
    const consumedDate = body.consumedDate ? new Date(body.consumedDate) : new Date()

    let confirmed = 0
    let skipped = 0

    for (const item of matchActions) {
      if (item.action === 'skip') {
        await prisma.importRow.update({ where: { id: item.importRowId }, data: { status: 'SKIPPED' } }).catch(() => {})
        skipped++
        continue
      }

      if (item.action === 'consume' && item.matchedWineId) {
        const wine = await prisma.wine.findFirst({
          where: { id: item.matchedWineId, userId: user.id },
        })
        if (wine) {
          const remaining = wine.quantity - wine.consumedQuantity
          if (remaining > 0) {
            await prisma.$transaction([
              prisma.wine.update({
                where: { id: wine.id },
                data: { consumedQuantity: wine.quantity, isFullyConsumed: true },
              }),
              prisma.consumptionLog.create({
                data: {
                  wineId: wine.id,
                  userId: user.id,
                  quantity: remaining,
                  consumedDate,
                  occasion: 'Cellar match import',
                },
              }),
            ])
          }
          await prisma.importRow.update({
            where: { id: item.importRowId },
            data: { status: 'CONFIRMED', wineId: wine.id },
          }).catch(() => {})
          confirmed++
        }
      } else if (item.action === 'add_new') {
        const row = importRecord.rows.find((r) => r.id === item.importRowId)
        if (row?.mappedData) {
          const mapped = row.mappedData as unknown as MappedWineData
          if (mapped.producer?.trim() && mapped.wineName?.trim()) {
            const qty = mapped.quantity && mapped.quantity > 0 ? Math.round(mapped.quantity) : 1
            const wine = await prisma.wine.create({
              data: {
                userId: user.id,
                importId: importRecord.id,
                ...toWineCreateData(mapped),
                isFullyConsumed: true,
                consumedQuantity: qty,
              },
            })
            await prisma.consumptionLog.create({
              data: {
                wineId: wine.id,
                userId: user.id,
                quantity: qty,
                consumedDate,
                occasion: 'Cellar match import — new record',
              },
            })
            await prisma.importRow.update({
              where: { id: item.importRowId },
              data: { status: 'CONFIRMED', wineId: wine.id },
            }).catch(() => {})
            confirmed++
          }
        }
      }
    }

    await prisma.import.update({
      where: { id: importRecord.id },
      data: { status: 'COMPLETE', recordCount: confirmed, skippedCount: skipped, completedAt: new Date() },
    })

    revalidatePath('/dashboard')
    revalidatePath('/dashboard/cellar')
    revalidatePath('/dashboard/import')
    revalidatePath(`/dashboard/import/${importRecord.id}`)

    return NextResponse.json({ success: true, confirmed, skipped })
  }

  let consumedRowIds: Set<string> = new Set()
  let locationDecisions: Record<string, 'merge' | 'separate'> = {}
  try {
    const body = await request.json().catch(() => ({}))
    if (Array.isArray(body?.consumedRowIds)) {
      consumedRowIds = new Set(body.consumedRowIds as string[])
    }
    if (body?.locationDecisions && typeof body.locationDecisions === 'object') {
      locationDecisions = body.locationDecisions
    }
  } catch {
    // No body or invalid JSON is fine -- defaults to no consumed rows
  }

  const historicalDate = importRecord.historicalConsumedDate ?? new Date()

  const rowsToImport = importRecord.rows.filter((row) => row.status !== 'SKIPPED')
  const skippedRows = importRecord.rows.filter((row) => row.status === 'SKIPPED')

  if (rowsToImport.length === 0) {
    return NextResponse.json({ error: 'No rows selected to import' }, { status: 400 })
  }

  let labelPhotoUrl: string | null = null
  if (importRecord.sourceType === 'IMAGE') {
    labelPhotoUrl = await copyLabelPhoto(user.id, importRecord.storagePath)
  }

  // Layer 2 — pre-confirm enrichment safety net, one batched call for the
  // whole run (not per-row) to stay inside maxDuration.
  const enrichableRows: EnrichableRow[] = rowsToImport.map((row) => ({
    mappedData: (row.mappedData ?? {}) as unknown as MappedWineData,
    confidenceScores: (row.confidenceScores ?? {}) as unknown as Record<string, unknown>,
  }))
  const enrichedRows = await runEnrichment(enrichableRows, {
    layer: 'pre-confirm',
    fields: CONFIRM_ENRICHABLE_FIELDS,
  })

  // Reconciliation match-check, once for the whole batch, against the
  // (now-enriched) mapped data.
  const outcomes = await findMergeMatches(user.id, enrichedRows.map((r) => r.mappedData))

  // Resolve 'needs-decision' rows to an effective merge-or-new outcome using
  // the client's choice, defaulting to 'separate' (safe, non-destructive)
  // when a decision wasn't provided.
  const resolvedOutcomes: Array<{ outcome: MergeOutcome; effectiveType: 'new' | 'merge'; setLocation?: string }> =
    rowsToImport.map((row, i) => {
      const outcome = outcomes[i]
      if (outcome.type === 'merge') return { outcome, effectiveType: 'merge' as const }
      if (outcome.type === 'new') return { outcome, effectiveType: 'new' as const }
      const decision = locationDecisions[row.id]
      if (decision === 'merge') {
        return { outcome, effectiveType: 'merge' as const, setLocation: outcome.importedLocation }
      }
      return { outcome, effectiveType: 'new' as const }
    })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function sendProgress(imported: number, total: number) {
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: 'progress', imported, total }) + '\n')
        )
      }

      let totalImported = 0
      let totalMerged = 0
      let totalFallback = 0
      let totalFailed = 0
      const rowErrors: Array<{ rowId: string; producer?: string; wineName?: string; error: string }> = []

      type RowOutcome = { merged: true; usedFallback: false } | { merged: false; usedFallback: boolean; wineId: string }

      try {
        for (let i = 0; i < rowsToImport.length; i += BATCH_SIZE) {
          const batch = rowsToImport.slice(i, i + BATCH_SIZE)

          const results = await Promise.allSettled(
            batch.map(async (row, batchIdx): Promise<RowOutcome> => {
              const globalIdx = i + batchIdx
              // Layer 2 — final normalization pass before writing to the
              // database (in addition to the normalization already applied
              // inside runEnrichment above, this also catches appellation
              // inference on any region/subRegion Claude just filled in).
              const mapped = clampNumericFields(
                normalizeWineData(enrichedRows[globalIdx].mappedData) as MappedWineData
              )
              const isConsumed = consumedRowIds.has(row.id)
              const quantity = mapped.quantity && mapped.quantity > 0 ? Math.round(mapped.quantity) : 1
              const resolved = resolvedOutcomes[globalIdx]

              if (resolved.effectiveType === 'merge' && resolved.outcome.type !== 'new') {
                const { wineId } = await mergeIntoExistingWine(
                  { wineId: resolved.outcome.wineId, existing: resolved.outcome.existing },
                  mapped,
                  quantity,
                  isConsumed,
                  resolved.setLocation
                )

                if (isConsumed) {
                  await prisma.consumptionLog.create({
                    data: {
                      wineId,
                      userId: user.id,
                      quantity,
                      consumedDate: historicalDate,
                      occasion: 'Historical import',
                      notes: 'Imported from historical collection',
                    },
                  })
                }

                await prisma.importRow.update({
                  where: { id: row.id },
                  data: {
                    status: 'CONFIRMED',
                    wineId,
                    reviewNotes: 'Merged with existing wine — quantity updated, blank fields filled in',
                  },
                })

                return { merged: true, usedFallback: false }
              }

              const { wine, note } = await createWineWithFallback(
                {
                  userId: user.id,
                  importId: importRecord.id,
                  ...toWineCreateData(mapped),
                  ...(labelPhotoUrl ? { labelPhotoUrl } : {}),
                  ...(isConsumed ? { isFullyConsumed: true, consumedQuantity: quantity } : {}),
                },
                mapped
              )

              if (note) {
                await prisma.wine.update({
                  where: { id: wine.id },
                  data: { notes: appendNote(wine.notes, note) },
                })
              }

              if (wine.vintage === null) {
                try {
                  await prisma.cellarAlert.create({
                    data: {
                      userId: user.id,
                      wineId: wine.id,
                      alertType: 'MISSING_DATA',
                      message: `Wine imported without a vintage year: ${wine.producer} ${wine.wineName} — please update manually`,
                      triggerDate: new Date(),
                    },
                  })
                } catch {
                  // Non-fatal — the wine is already saved; a missing alert
                  // just means no reminder surfaces, not a broken import.
                }
              }

              await prisma.importRow.update({
                where: { id: row.id },
                data: { status: 'CONFIRMED', wineId: wine.id },
              })

              if (isConsumed) {
                await prisma.consumptionLog.create({
                  data: {
                    wineId: wine.id,
                    userId: user.id,
                    quantity,
                    consumedDate: historicalDate,
                    occasion: 'Historical import',
                    notes: 'Imported from historical collection',
                  },
                })
              }

              return { merged: false, usedFallback: !!note, wineId: wine.id }
            })
          )

          for (let j = 0; j < results.length; j++) {
            const outcome = results[j]
            const row = batch[j]

            if (outcome.status === 'fulfilled') {
              totalImported++
              if (outcome.value.merged) {
                totalMerged++
              } else {
                if (outcome.value.usedFallback) totalFallback++
              }
              continue
            }

            // Every fallback tier failed — this is a genuine failure, not a
            // user Skip, so the row is left untouched (still PENDING) rather
            // than marked SKIPPED. It's surfaced in the summary instead.
            totalFailed++
            const mapped = (row.mappedData ?? {}) as unknown as MappedWineData
            const message = outcome.reason instanceof Error ? outcome.reason.message : 'Failed to import row'
            rowErrors.push({ rowId: row.id, producer: mapped.producer, wineName: mapped.wineName, error: message })
          }

          sendProgress(totalImported + totalFailed, rowsToImport.length)
        }

        const allRowsFailed = totalImported === 0 && rowsToImport.length > 0

        await prisma.import.update({
          where: { id: importRecord.id },
          data: {
            status: allRowsFailed ? 'FAILED' : 'COMPLETE',
            recordCount: totalImported,
            skippedCount: skippedRows.length,
            completedAt: new Date(),
            ...(rowErrors.length > 0
              ? { errorMessage: `${rowErrors.length} row(s) could not be imported even after fallback` }
              : {}),
          },
        })

        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'complete',
              imported: totalImported,
              merged: totalMerged,
              skipped: skippedRows.length,
              fallback: totalFallback,
              failed: totalFailed,
              errors: rowErrors,
            }) + '\n'
          )
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import failed'
        await prisma.import.update({
          where: { id: importRecord.id },
          data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
        }).catch(() => {})

        controller.enqueue(
          encoder.encode(JSON.stringify({ type: 'error', error: message }) + '\n')
        )
      } finally {
        controller.close()
      }
    },
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/cellar')
  revalidatePath('/dashboard/import')
  revalidatePath('/dashboard/import/history')
  revalidatePath(`/dashboard/import/${importRecord.id}`)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  })
}
