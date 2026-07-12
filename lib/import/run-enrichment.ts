import { enrichFromStaticDataset, type EnrichableRow } from './enrich-from-static'
import { enrichFromClaude } from './enrich-from-claude'
import { enrichRatings } from './enrich-rating'
import { ENRICHABLE_FIELDS, type EnrichableField, type ConfirmEnrichableField } from './enrichable-fields'

export type EnrichmentLayer = 'pre-review' | 'pre-confirm' | 'post-confirm'

export interface EnrichmentContext {
  layer: EnrichmentLayer
  fields?: readonly ConfirmEnrichableField[]
}

// Claude's batched enrichment call sends every row needing enrichment in one
// message. Spreadsheet imports can be up to 5000 rows (MAX_CSV_ROWS) — chunk
// so a single call never scales unbounded with import size.
const CLAUDE_CHUNK_SIZE = 150

async function enrichFromClaudeChunked(
  rows: EnrichableRow[],
  fields: readonly EnrichableField[]
): Promise<EnrichableRow[]> {
  if (rows.length <= CLAUDE_CHUNK_SIZE) return enrichFromClaude(rows, fields)

  const result: EnrichableRow[] = []
  for (let i = 0; i < rows.length; i += CLAUDE_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CLAUDE_CHUNK_SIZE)
    result.push(...(await enrichFromClaude(chunk, fields)))
  }
  return result
}

// THE single enrichment entrypoint. Every import path (spreadsheet mapping
// route, PDF/HTML/photo processing, confirm route Layer 2/3) must call this
// rather than the individual enrichFromStaticDataset/enrichFromClaude
// functions directly, so enrichment logic can never diverge across paths.
// See lib/import/processor.ts, app/api/import/[id]/mapping/route.ts, and
// app/api/import/[id]/confirm/route.ts for the required call sites.
export async function runEnrichment(
  rows: EnrichableRow[],
  { fields = ENRICHABLE_FIELDS }: EnrichmentContext
): Promise<EnrichableRow[]> {
  try {
    const baseFields = fields.filter((f): f is EnrichableField => f !== 'rating')

    let result = enrichFromStaticDataset(rows, baseFields)
    result = await enrichFromClaudeChunked(result, baseFields)

    if (fields.includes('rating')) {
      result = await enrichRatings(result)
    }

    return result
  } catch {
    // Enrichment must never block or fail an import — worst case, rows keep
    // whatever blanks they had going in.
    return rows
  }
}
