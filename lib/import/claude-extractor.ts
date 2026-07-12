import { z } from 'zod'
import { anthropic, CLAUDE_MODEL } from '@/lib/ai/client'
import { IMPORT_TARGET_FIELDS, type ConfidenceScores, type MappedWineData } from './constants'
import { normalizeWineData } from '@/lib/wines/normalize'
import { REGION_SUBREGION_PAIRS, COUNTRY_STATE_PAIRS } from '@/lib/wines/region-data'

const WINE_FIELD_PROPERTIES = {
  producer: { type: 'string', description: 'Producer / winery name' },
  wineName: { type: 'string', description: 'Wine name (cuvee/bottling), without producer or vintage' },
  vintage: { type: 'number', description: '4-digit vintage year' },
  country: { type: 'string', description: 'e.g. France, Italy, United States. Infer from state/region when possible (California → United States, South Australia → Australia).' },
  state: { type: 'string', description: 'US state, Australian state, Canadian province, etc. e.g. California, Oregon, South Australia, Ontario' },
  region: { type: 'string', description: 'e.g. Bordeaux, Napa Valley' },
  subRegion: { type: 'string', description: 'Sub-region or appellation (e.g. AVA, DOC, DOCG, AOC) — treat "appellation" and "sub-region" as the same field.' },
  vineyard: { type: 'string', description: 'Specific vineyard designation (e.g. To Kalon Vineyard, Beckstoffer Georges III). Common in Napa/Sonoma. Distinct from sub-region.' },
  classification: { type: 'string', description: 'e.g. Grand Cru, 1er Cru, DOCG' },
  varietal: { type: 'string', description: 'Primary grape variety or blend name' },
  format: { type: 'string', description: 'Bottle size, e.g. 750mL (Standard), 1.5L (Magnum)' },
  style: { type: 'string', description: 'Wine style/color, e.g. Red, White, Rosé, Sparkling, Dessert, Fortified' },
  quantity: { type: 'number', description: 'Number of bottles' },
  purchasePrice: { type: 'number', description: 'Actual price paid per bottle. On invoices with two prices (retail/list vs. member/sale/you-pay), this is the LOWER price the buyer actually paid.' },
  purchaseDate: { type: 'string', description: 'ISO 8601 date, e.g. 2024-03-15' },
  vendor: { type: 'string' },
  storageLocation: { type: 'string' },
  currentEstValue: { type: 'number', description: 'Current estimated market/retail value per bottle. On invoices with a crossed-out/strikethrough retail price and a lower actual price, this is the HIGHER retail/list price.' },
  totalCostOverride: { type: 'number', description: 'Total cost for all bottles (only if explicitly stated as a total, not per-bottle price)' },
  totalValueOverride: { type: 'number', description: 'Total estimated value for all bottles (only if explicitly stated as a total)' },
  rating: { type: 'number', description: 'Critic or personal score out of 100' },
  drinkWindowStart: { type: 'number', description: '4-digit year the wine begins drinking well' },
  drinkWindowEnd: { type: 'number', description: '4-digit year by which the wine should be drunk' },
  tastingNotes: { type: 'string', description: 'Tasting notes describing aroma, flavor, and structure' },
  pairingNotes: { type: 'string', description: 'Food pairing suggestions' },
  wineId: { type: 'string', description: 'An inventory or lot ID assigned by the collector or seller' },
  notes: { type: 'string' },
}

const mappedWineDataSchema = z.object({
  producer: z.string().optional(),
  wineName: z.string().optional(),
  vintage: z.number().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  region: z.string().optional(),
  subRegion: z.string().optional(),
  vineyard: z.string().optional(),
  classification: z.string().optional(),
  varietal: z.string().optional(),
  format: z.string().optional(),
  style: z.string().optional(),
  quantity: z.number().optional(),
  purchasePrice: z.number().optional(),
  purchaseDate: z.string().optional(),
  vendor: z.string().optional(),
  storageLocation: z.string().optional(),
  currentEstValue: z.number().optional(),
  totalCostOverride: z.number().optional(),
  totalValueOverride: z.number().optional(),
  rating: z.number().optional(),
  drinkWindowStart: z.number().optional(),
  drinkWindowEnd: z.number().optional(),
  tastingNotes: z.string().optional(),
  pairingNotes: z.string().optional(),
  wineId: z.string().optional(),
  notes: z.string().optional(),
})

const confidenceScoresSchema = z.record(z.string(), z.number())

const extractedRowSchema = z.object({
  mappedData: mappedWineDataSchema,
  confidenceScores: confidenceScoresSchema,
})

const extractedRowsSchema = z.object({
  wines: z.array(extractedRowSchema),
})

const columnMappingSchema = z.object({
  mapping: z.record(z.string(), z.string().nullable()),
})

export interface ExtractedRow {
  mappedData: MappedWineData
  confidenceScores: ConfidenceScores
}

// Claude sometimes returns a placeholder string instead of omitting a field it
// couldn't determine. Strip these (and a literal vintage of 0) to null/omitted
// so they don't get imported as real data or trip required-field validation.
const PLACEHOLDER_VALUES = [
  'unknown', 'n/a', 'not specified', 'not available',
  'none', 'na', 'unspecified', '-', '--',
]

function isPlaceholderString(value: unknown): boolean {
  return typeof value === 'string' && PLACEHOLDER_VALUES.includes(value.trim().toLowerCase())
}

function stripPlaceholders(row: ExtractedRow): ExtractedRow {
  const mappedData = { ...row.mappedData } as Record<string, unknown>
  const confidenceScores = { ...row.confidenceScores } as Record<string, number>

  for (const key of Object.keys(mappedData)) {
    const value = mappedData[key]
    const isZeroVintage = key === 'vintage' && (value === 0 || value === '0')
    if (isPlaceholderString(value) || isZeroVintage) {
      delete mappedData[key]
      delete confidenceScores[key]
    }
  }

  return {
    mappedData: mappedData as MappedWineData,
    confidenceScores: confidenceScores as ConfidenceScores,
  }
}

// Post-processing applied to every row Claude extracts, before the row is
// handed back to the caller: normalize (split combined values, correct
// spelling/casing, infer appellation, strip separator artifacts) first, then
// drop placeholder values like "Unknown".
function postProcessExtractedRow(row: ExtractedRow): ExtractedRow {
  return stripPlaceholders({
    mappedData: normalizeWineData(row.mappedData),
    confidenceScores: row.confidenceScores,
  })
}

function stripPlaceholdersFromRows(rows: ExtractedRow[]): ExtractedRow[] {
  return rows.map(postProcessExtractedRow)
}

function extractToolInput(
  message: { content: Array<{ type: string; name?: string; input?: unknown }> },
  toolName: string
): unknown {
  const block = message.content.find((b) => b.type === 'tool_use' && b.name === toolName)
  return block?.input
}

export function detectRegionSplit(
  sampleValues: string[]
): { shouldSplit: boolean; separator: string } {
  const separators = [', ', ' - ', ' / ']
  for (const sep of separators) {
    let matchCount = 0
    for (const value of sampleValues) {
      if (!value.includes(sep)) continue
      const parts = value.split(sep)
      if (parts.length < 2) continue
      const first = parts[0].trim().toLowerCase()
      const rest = parts.slice(1).join(sep).trim().toLowerCase()
      const knownSubs = REGION_SUBREGION_PAIRS[first]
      if (knownSubs && knownSubs.some((s) => rest.includes(s))) {
        matchCount++
      } else {
        for (const [region, subs] of Object.entries(REGION_SUBREGION_PAIRS)) {
          if (first.includes(region) || region.includes(first)) {
            if (subs.some((s) => rest.includes(s))) {
              matchCount++
              break
            }
          }
        }
      }
    }
    if (matchCount >= 2 || (sampleValues.length <= 3 && matchCount >= 1)) {
      return { shouldSplit: true, separator: sep }
    }
  }
  return { shouldSplit: false, separator: '' }
}

export function splitRegionValue(
  value: string,
  separator: string
): { region: string; subRegion: string } {
  const idx = value.indexOf(separator)
  if (idx === -1) return { region: value.trim(), subRegion: '' }
  return {
    region: value.substring(0, idx).trim(),
    subRegion: value.substring(idx + separator.length).trim(),
  }
}

export function detectCountryStateSplit(
  sampleValues: string[]
): { shouldSplit: boolean; separator: string } {
  const separators = [', ', ' - ', ' / ']
  for (const sep of separators) {
    let matchCount = 0
    for (const value of sampleValues) {
      if (!value.includes(sep)) continue
      const parts = value.split(sep)
      if (parts.length < 2) continue
      const first = parts[0].trim().toLowerCase()
      const rest = parts.slice(1).join(sep).trim().toLowerCase()
      const knownStates = COUNTRY_STATE_PAIRS[first]
      if (knownStates && knownStates.some((s) => rest.includes(s))) {
        matchCount++
      } else {
        for (const [country, states] of Object.entries(COUNTRY_STATE_PAIRS)) {
          if (first.includes(country) || country.includes(first)) {
            if (states.some((s) => rest.includes(s))) {
              matchCount++
              break
            }
          }
        }
      }
    }
    if (matchCount >= 2 || (sampleValues.length <= 3 && matchCount >= 1)) {
      return { shouldSplit: true, separator: sep }
    }
  }
  return { shouldSplit: false, separator: '' }
}

export function splitCountryStateValue(
  value: string,
  separator: string
): { country: string; state: string } {
  const idx = value.indexOf(separator)
  if (idx === -1) return { country: value.trim(), state: '' }
  return {
    country: value.substring(0, idx).trim(),
    state: value.substring(idx + separator.length).trim(),
  }
}

export interface ColumnMappingSuggestion {
  mapping: Record<string, string | null>
  regionSplitColumns: Record<string, string>
  countryStateSplitColumns: Record<string, string>
}

export async function suggestColumnMapping(
  headers: string[],
  sampleRows: Record<string, string>[]
): Promise<ColumnMappingSuggestion> {
  const targetFieldList = IMPORT_TARGET_FIELDS.map((f) => `- ${f.key}: ${f.label}`).join('\n')

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: 'suggest_mapping',
        description:
          'Map each source spreadsheet column header to the matching target wine field, or null if no field matches.',
        input_schema: {
          type: 'object',
          properties: {
            mapping: {
              type: 'object',
              description:
                'Keys are the exact source column headers provided. Values are one of the target field keys listed, or null if the column has no corresponding wine field.',
              additionalProperties: { type: ['string', 'null'] },
            },
          },
          required: ['mapping'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'suggest_mapping' },
    messages: [
      {
        role: 'user',
        content: `Map each source spreadsheet column header to one of these target wine fields, or null if there's no good match:\n${targetFieldList}\n\nSource headers: ${JSON.stringify(headers)}\n\nSample rows:\n${JSON.stringify(sampleRows, null, 2)}`,
      },
    ],
  })

  const parsed = columnMappingSchema.safeParse(extractToolInput(message, 'suggest_mapping'))
  if (!parsed.success) return { mapping: {}, regionSplitColumns: {}, countryStateSplitColumns: {} }

  const validKeys = new Set<string>(IMPORT_TARGET_FIELDS.map((f) => f.key))
  const mapping: Record<string, string | null> = {}
  for (const header of headers) {
    const value = parsed.data.mapping[header]
    mapping[header] = value && validKeys.has(value) ? value : null
  }

  const regionSplitColumns: Record<string, string> = {}
  for (const header of headers) {
    if (mapping[header] !== 'region') continue
    const sampleValues = sampleRows
      .map((row) => row[header]?.trim())
      .filter((v): v is string => Boolean(v))
    const detection = detectRegionSplit(sampleValues)
    if (detection.shouldSplit) {
      regionSplitColumns[header] = detection.separator
    }
  }

  const countryStateSplitColumns: Record<string, string> = {}
  for (const header of headers) {
    if (mapping[header] !== 'country') continue
    const sampleValues = sampleRows
      .map((row) => row[header]?.trim())
      .filter((v): v is string => Boolean(v))
    const detection = detectCountryStateSplit(sampleValues)
    if (detection.shouldSplit) {
      countryStateSplitColumns[header] = detection.separator
    }
  }

  return { mapping, regionSplitColumns, countryStateSplitColumns }
}

export async function extractWinesFromText(text: string, attempt = 0): Promise<ExtractedRow[]> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [
      {
        name: 'extract_wines',
        description:
          'Record structured wine data extracted from the source document. Include one entry per distinct wine line item found.',
        input_schema: {
          type: 'object',
          properties: {
            wines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mappedData: {
                    type: 'object',
                    description: 'Wine fields extracted for this line item. Omit fields you cannot determine.',
                    properties: WINE_FIELD_PROPERTIES,
                  },
                  confidenceScores: {
                    type: 'object',
                    description: 'Confidence from 0 to 1 for each field present in mappedData.',
                    additionalProperties: { type: 'number' },
                  },
                },
                required: ['mappedData', 'confidenceScores'],
              },
            },
          },
          required: ['wines'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_wines' },
    messages: [
      {
        role: 'user',
        content: `Extract every individual wine line item from this invoice/inventory text. For each wine, fill in as many fields as you can confidently determine and give a confidence score (0-1) for each field you populate. Omit fields you cannot determine rather than guessing — never return placeholder text such as "Unknown", "N/A", "Not specified", "Not available", or "None" as a field value, and never return 0 for vintage when the year is unknown; simply leave the key out of mappedData.\n\nPRICE HANDLING — many invoices show two prices per wine:\n- Patterns: "Retail: $150 / Member: $95", "$150 $95", "List: $150 You Pay: $95", "MSRP $150 Sale $95", "Regular Price ... Sale Price"\n- When two prices are present: the higher price (retail/list/regular/MSRP) goes into currentEstValue; the lower price (member/sale/you-pay/actual) goes into purchasePrice.\n- When only one price is present: it goes into purchasePrice.\n- When two prices exist but it is unclear which is retail vs. paid: assign the lower to purchasePrice and the higher to currentEstValue, and set confidence for BOTH price fields below 0.6.\n\nFor Napa Valley and Sonoma wines, look for vineyard designations (e.g. "To Kalon Vineyard", "Beckstoffer Georges III", "Bien Nacido") and extract them into the vineyard field, separate from sub-region.\n\nInfer the country from the state or region when possible (e.g. California/Oregon/Washington → United States, South Australia/Victoria → Australia, Ontario/British Columbia → Canada). Populate the state field for US states, Australian states, and Canadian provinces. Infer style (Red, White, Rosé, Sparkling, Dessert, Fortified) from the varietal, region, or wine name when style is not explicitly stated.\n\nText:\n${text}`,
      },
    ],
  })

  const parsed = extractedRowsSchema.safeParse(extractToolInput(message, 'extract_wines'))
  if (!parsed.success) {
    if (attempt === 0) return extractWinesFromText(text, 1)
    return []
  }
  return stripPlaceholdersFromRows(parsed.data.wines)
}

export async function extractWinesFromPdf(pages: string[], batchSize: number): Promise<ExtractedRow[]> {
  const results: ExtractedRow[] = []

  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize)
    const text = batch.join('\n\n--- Page break ---\n\n')
    if (!text.trim()) continue

    const extracted = await extractWinesFromText(text)
    results.push(...extracted)
  }

  return results
}

export async function extractWinesFromImage(
  base64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
  attempt = 0
): Promise<ExtractedRow[]> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [
      {
        name: 'extract_wines',
        description:
          'Record structured wine data extracted from an image. Include one entry per distinct wine found.',
        input_schema: {
          type: 'object',
          properties: {
            wines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mappedData: {
                    type: 'object',
                    description: 'Wine fields identified for this wine. Omit fields you cannot determine.',
                    properties: WINE_FIELD_PROPERTIES,
                  },
                  confidenceScores: {
                    type: 'object',
                    description: 'Confidence from 0 to 1 for each field present in mappedData.',
                    additionalProperties: { type: 'number' },
                  },
                },
                required: ['mappedData', 'confidenceScores'],
              },
            },
          },
          required: ['wines'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_wines' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: 'This image is one of: a photo of a wine label, a photo of a paper invoice or receipt, or a screenshot of an HTML invoice/order confirmation. Extract every distinct wine. A label photo is typically a single wine; an invoice or receipt may list several. For each wine, fill in as many fields as you can confidently determine (producer, wine name, vintage, country, state/province, region, varietal, classification, vineyard designation, format, style, quantity, purchase price, purchase date, vendor, current estimated value, rating, drink window, tasting/pairing notes, wine ID, etc.) and give a confidence score (0-1) for each field you populate. Omit fields you cannot determine rather than guessing — never return placeholder text such as "Unknown", "N/A", "Not specified", "Not available", or "None" as a field value, and never return 0 for vintage when the year is unknown; simply leave the key out of mappedData.\n\nPRICE HANDLING — invoices often show two prices per wine:\n- Look for visual strikethrough/crossed-out formatting on the higher price, or labels like "retail", "regular", "list", "MSRP" vs. "you pay", "member price", "sale price", "club price".\n- When two prices are present: the higher (retail/list/strikethrough) goes into currentEstValue; the lower (actual/member/sale) goes into purchasePrice.\n- When only one price is present: it goes into purchasePrice.\n- When two prices exist but which is retail vs. paid is ambiguous: assign the lower to purchasePrice and the higher to currentEstValue, and set confidence for BOTH price fields below 0.6.\n\nFor Napa Valley and Sonoma wines, look for vineyard designations (e.g. "To Kalon Vineyard", "Beckstoffer Georges III") and extract them into the vineyard field, separate from sub-region. Infer country from state/region when possible (California → United States, South Australia → Australia). Populate the state field for US states, Australian states, and Canadian provinces. Infer style (Red, White, Rosé, Sparkling, Dessert, Fortified) from the varietal or wine name when not explicitly stated.',
          },
        ],
      },
    ],
  })

  const parsed = extractedRowsSchema.safeParse(extractToolInput(message, 'extract_wines'))
  if (!parsed.success) {
    if (attempt === 0) return extractWinesFromImage(base64, mimeType, 1)
    return []
  }
  return stripPlaceholdersFromRows(parsed.data.wines)
}

export async function extractWinesFromInvoiceImage(
  base64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
  attempt = 0
): Promise<ExtractedRow[]> {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [
      {
        name: 'extract_wines',
        description:
          'Record structured wine data extracted from an invoice image. Include one entry per distinct wine line item found.',
        input_schema: {
          type: 'object',
          properties: {
            wines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  mappedData: {
                    type: 'object',
                    description: 'Wine fields identified for this wine. Omit fields you cannot determine.',
                    properties: WINE_FIELD_PROPERTIES,
                  },
                  confidenceScores: {
                    type: 'object',
                    description: 'Confidence from 0 to 1 for each field present in mappedData.',
                    additionalProperties: { type: 'number' },
                  },
                },
                required: ['mappedData', 'confidenceScores'],
              },
            },
          },
          required: ['wines'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_wines' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: 'This image is a wine purchase invoice, receipt, or order confirmation — either a photo of a paper invoice or a screenshot of an online order. It likely contains MULTIPLE wine line items. Extract EVERY distinct wine line item you can see. For each wine, fill in as many fields as you can confidently determine (producer, wine name, vintage, country, state/province, region, varietal, classification, vineyard designation, format, style, quantity, purchase price, purchase date, vendor, current estimated value, rating, drink window, tasting/pairing notes, wine ID, order number, etc.) and give a confidence score (0-1) for each field you populate. Omit fields you cannot determine rather than guessing — never return placeholder text such as "Unknown", "N/A", "Not specified", "Not available", or "None" as a field value, and never return 0 for vintage when the year is unknown; simply leave the key out of mappedData.\n\nPRICE HANDLING — invoices often show two prices per wine:\n- Look for visual strikethrough/crossed-out formatting on the higher price, or labels like "retail", "regular", "list", "MSRP" vs. "you pay", "member price", "sale price", "club price".\n- When two prices are present: the higher (retail/list/strikethrough) goes into currentEstValue; the lower (actual/member/sale) goes into purchasePrice.\n- When only one price is present: it goes into purchasePrice.\n- When two prices exist but which is retail vs. paid is ambiguous: assign the lower to purchasePrice and the higher to currentEstValue, and set confidence for BOTH price fields below 0.6.\n- Look for order totals or subtotals to distinguish per-bottle vs. per-case pricing. If a line shows "6 x $45" or "Qty: 6 @ $45", quantity is 6 and purchasePrice is 45.\n\nInfer country from state/region when possible (California → United States, South Australia → Australia). Populate the state field for US states, Australian states, and Canadian provinces. Infer style (Red, White, Rosé, Sparkling, Dessert, Fortified) from the varietal or wine name when not explicitly stated.',
          },
        ],
      },
    ],
  })

  const parsed = extractedRowsSchema.safeParse(extractToolInput(message, 'extract_wines'))
  if (!parsed.success) {
    if (attempt === 0) return extractWinesFromInvoiceImage(base64, mimeType, 1)
    return []
  }
  return stripPlaceholdersFromRows(parsed.data.wines)
}
