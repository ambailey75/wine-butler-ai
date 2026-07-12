import * as XLSX from 'xlsx'
import { IMPORT_TARGET_FIELDS, MAX_CSV_ROWS, type ConfidenceScores, type MappedWineData } from './constants'
import { normalizeWineData } from '@/lib/wines/normalize'

export interface ParsedSpreadsheet {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseSpreadsheet(buffer: Buffer): ParsedSpreadsheet {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return { headers: [], rows: [] }
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: '',
    raw: false,
  })

  const headers = rows.length > 0 ? Object.keys(rows[0]) : []
  return { headers, rows: rows.slice(0, MAX_CSV_ROWS) }
}

export interface MappingResult {
  mappedData: MappedWineData
  confidenceScores: ConfidenceScores
}

// Applies a header -> target-field mapping to one raw spreadsheet row.
// Numeric fields get currency/thousands symbols stripped before parsing.
// Required fields (producer/wineName) that end up empty get a low
// confidence score so the review UI can flag them.
export function applyColumnMapping(
  rawData: Record<string, string>,
  mapping: Record<string, string | null>
): MappingResult {
  const fieldByKey = new Map(IMPORT_TARGET_FIELDS.map((field) => [field.key, field]))
  const mappedData: Record<string, string | number> = {}
  const confidenceScores: ConfidenceScores = {}

  for (const [header, targetKey] of Object.entries(mapping)) {
    if (!targetKey) continue
    const field = fieldByKey.get(targetKey as keyof MappedWineData)
    if (!field) continue

    const rawValue = (rawData[header] ?? '').trim()
    if (!rawValue) continue

    if (field.type === 'number') {
      const num = Number(rawValue.replace(/[^0-9.-]/g, ''))
      if (Number.isNaN(num)) continue
      mappedData[field.key] = num
    } else {
      mappedData[field.key] = rawValue
    }
    confidenceScores[field.key] = 1
  }

  for (const field of IMPORT_TARGET_FIELDS) {
    if (field.required && !mappedData[field.key]) {
      confidenceScores[field.key] = 0.3
    }
  }

  return { mappedData: normalizeWineData(mappedData as MappedWineData) as MappedWineData, confidenceScores }
}
