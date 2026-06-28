import type { ImportSourceType } from '@prisma/client'

export const IMPORTS_BUCKET = 'imports'
export const LABELS_BUCKET = 'labels'

export const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB per CLAUDE.md
export const MAX_PDF_PAGES = 100
export const MAX_CSV_ROWS = 5000
export const PDF_PAGE_BATCH_SIZE = 15
export const LOW_CONFIDENCE_THRESHOLD = 0.6

export const ALLOWED_MIME_TYPES: Record<ImportSourceType, string[]> = {
  EXCEL: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ],
  CSV: ['text/csv', 'application/csv', 'application/vnd.ms-excel'],
  PDF: ['application/pdf', 'text/html', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  IMAGE: [
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'text/html',
    'message/rfc822', 'multipart/related', 'application/x-mimearchive', 'application/octet-stream',
  ],
}

const EXTENSION_SOURCE_TYPES: Record<string, ImportSourceType> = {
  csv: 'CSV',
  xlsx: 'EXCEL',
  xls: 'EXCEL',
  pdf: 'PDF',
  jpg: 'IMAGE',
  jpeg: 'IMAGE',
  png: 'IMAGE',
  webp: 'IMAGE',
  heic: 'IMAGE',
  heif: 'IMAGE',
  html: 'IMAGE',
  htm: 'IMAGE',
  mhtml: 'IMAGE',
  eml: 'IMAGE',
}

export function detectSourceType(filename: string, mimeType: string): ImportSourceType | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext && ext in EXTENSION_SOURCE_TYPES) {
    return EXTENSION_SOURCE_TYPES[ext]
  }
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType === 'text/html') return 'IMAGE'
  if (mimeType === 'text/csv') return 'CSV'
  if (mimeType.includes('spreadsheet') || mimeType === 'application/vnd.ms-excel') return 'EXCEL'
  return null
}

export interface MappedWineData {
  producer?: string
  wineName?: string
  vintage?: number
  country?: string
  state?: string
  region?: string
  subRegion?: string
  vineyard?: string
  classification?: string
  varietal?: string
  format?: string
  style?: string
  quantity?: number
  purchasePrice?: number
  purchaseDate?: string
  vendor?: string
  storageLocation?: string
  notes?: string
  tastingNotes?: string
  pairingNotes?: string
  rating?: number
  drinkWindowStart?: number
  drinkWindowEnd?: number
  currentEstValue?: number
  totalCostOverride?: number
  totalValueOverride?: number
  wineId?: string
}

export type ConfidenceScores = Partial<Record<keyof MappedWineData, number>>

export interface ImportTargetField {
  key: keyof MappedWineData
  label: string
  type: 'string' | 'number' | 'date'
  required?: boolean
}

export const IMPORT_TARGET_FIELDS: ImportTargetField[] = [
  { key: 'producer', label: 'Producer', type: 'string', required: true },
  { key: 'wineName', label: 'Wine Name', type: 'string', required: true },
  { key: 'vintage', label: 'Vintage', type: 'number' },
  { key: 'country', label: 'Country', type: 'string' },
  { key: 'state', label: 'State/Province', type: 'string' },
  { key: 'region', label: 'Region', type: 'string' },
  { key: 'subRegion', label: 'Sub-Region', type: 'string' },
  { key: 'vineyard', label: 'Vineyard', type: 'string' },
  { key: 'classification', label: 'Classification', type: 'string' },
  { key: 'varietal', label: 'Varietal', type: 'string' },
  { key: 'format', label: 'Format', type: 'string' },
  { key: 'style', label: 'Style', type: 'string' },
  { key: 'quantity', label: 'Quantity', type: 'number' },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'number' },
  { key: 'purchaseDate', label: 'Purchase Date', type: 'date' },
  { key: 'vendor', label: 'Vendor', type: 'string' },
  { key: 'storageLocation', label: 'Storage Location', type: 'string' },
  { key: 'currentEstValue', label: 'Current Est. Value', type: 'number' },
  { key: 'totalCostOverride', label: 'Total Cost', type: 'number' },
  { key: 'totalValueOverride', label: 'Total Est. Value', type: 'number' },
  { key: 'rating', label: 'Rating', type: 'number' },
  { key: 'drinkWindowStart', label: 'Drink Window Start', type: 'number' },
  { key: 'drinkWindowEnd', label: 'Drink Window End', type: 'number' },
  { key: 'tastingNotes', label: 'Tasting Notes', type: 'string' },
  { key: 'pairingNotes', label: 'Pairing Notes', type: 'string' },
  { key: 'wineId', label: 'Wine ID', type: 'string' },
  { key: 'notes', label: 'Notes', type: 'string' },
]

// Maps common CSV column header variants (normalized: lowercase, alphanumeric
// only) to a target field key, or `null` to force-skip a computed column.
// Checked before the generic key/label match in ColumnMappingForm so e.g. a
// plain "Notes" column lands on tastingNotes (per-bottle notes) rather than
// the cellar-management notes field, and "Total Cost"/"Total Est. Value"
// (computed at query time) are never offered as import targets.
export const HEADER_ALIASES: Record<string, keyof MappedWineData | null> = {
  notes: 'tastingNotes',
  appellation: 'subRegion',
  vineyard: 'vineyard',
  vineyarddesignation: 'vineyard',
  bottlesize: 'format',
  drinkingwindowstart: 'drinkWindowStart',
  drinkingwindowend: 'drinkWindowEnd',
  totalcost: 'totalCostOverride',
  totalestvalue: 'totalValueOverride',
  totalvalue: 'totalValueOverride',
  state: 'state',
  stateprovince: 'state',
  province: 'state',
}
