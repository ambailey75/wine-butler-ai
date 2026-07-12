import { anthropic, CLAUDE_MODEL } from '@/lib/ai/client'
import type { MappedWineData } from './constants'
import type { EnrichableRow } from './enrich-from-static'
import { ENRICHABLE_FIELDS, NUMERIC_ENRICHABLE_FIELDS, getBlankFields, type EnrichableField } from './enrichable-fields'
import { normalizeVarietal, normalizeRegionSpelling } from '@/lib/wines/normalize'

function coerce(field: EnrichableField, val: unknown): string | number | undefined {
  if (val === null || val === undefined || val === '') return undefined
  if (NUMERIC_ENRICHABLE_FIELDS.has(field)) {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10)
    return Number.isNaN(n) ? undefined : n
  }
  return typeof val === 'string' ? val : String(val)
}

export async function enrichFromClaude(
  rows: EnrichableRow[],
  fields: readonly EnrichableField[] = ENRICHABLE_FIELDS
): Promise<EnrichableRow[]> {
  const needsEnrichment = rows
    .map((row, i) => ({ i, row, blanks: getBlankFields(row.mappedData, fields) }))
    .filter(({ blanks }) => blanks.length > 0)

  if (!needsEnrichment.length) return rows

  const systemPrompt =
    'You are a wine expert. Given a JSON array of wines, fill any blank fields from your knowledge. ' +
    'For "subRegion", provide the appellation (e.g. AVA, DOC, DOCG, AOC) if you don\'t know a more specific sub-region — treat appellation and sub-region as the same field. ' +
    'Return ONLY a JSON array — no explanation. Each element: {"index":<number>,"filled":{<field>:<value>,...}}. ' +
    'Only fill fields listed in blankFields. Omit fields you are uncertain about. Never guess.'

  try {
    const payload = needsEnrichment.map(({ i, row, blanks }) => ({
      index: i,
      producer: row.mappedData.producer,
      wineName: row.mappedData.wineName,
      vintage: row.mappedData.vintage,
      country: row.mappedData.country,
      region: row.mappedData.region,
      blankFields: blanks,
    }))

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })

    const text = response.content.find((c) => c.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return rows

    const parsed = JSON.parse(jsonMatch[0]) as { index: number; filled: Record<string, unknown> }[]

    const result: EnrichableRow[] = rows.map((row) => ({
      mappedData: { ...row.mappedData },
      confidenceScores: { ...row.confidenceScores },
    }))

    for (const { index, filled } of parsed) {
      if (index < 0 || index >= result.length) continue
      for (const field of fields) {
        const raw = filled[field]
        if (raw === undefined) continue
        if (result[index].mappedData[field as keyof MappedWineData]) continue
        let val = coerce(field, raw)
        if (val === undefined) continue
        // Prevent Claude's own phrasing from reintroducing non-standard
        // spelling/casing even after the upstream normalization pass.
        if (typeof val === 'string' && (field === 'region' || field === 'subRegion')) {
          val = normalizeRegionSpelling(val)
        } else if (typeof val === 'string' && field === 'varietal') {
          val = normalizeVarietal(val)
        }
        ;(result[index].mappedData as Record<string, unknown>)[field] = val
        result[index].confidenceScores[field] = 0.75
        result[index].confidenceScores[`_src_${field}`] = 'ai-suggested'
      }
    }

    return result
  } catch {
    // Enrichment failure is non-fatal — show review table without enrichment
    return rows
  }
}
