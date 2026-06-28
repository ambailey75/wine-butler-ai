import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { parseSpreadsheet } from './excel'
import { extractPdfPages } from './pdf'
import { fileToBase64 } from './image'
import { extractWinesFromPdf, extractWinesFromImage, extractWinesFromInvoiceImage, extractWinesFromText, suggestColumnMapping } from './claude-extractor'
import { PDF_PAGE_BATCH_SIZE } from './constants'

export interface ProcessResult {
  mappingSuggestion?: Record<string, string | null>
  regionSplitColumns?: Record<string, string>
  countryStateSplitColumns?: Record<string, string>
}

// Parses/extracts the uploaded file and creates ImportRows, then transitions
// Import to REVIEW (or FAILED). Called synchronously from the upload route;
// kept isolated here as a seam for a future background-job approach.
export async function processImport(importId: string, file: File, sourceHint?: string): Promise<ProcessResult> {
  const importRecord = await prisma.import.findUniqueOrThrow({ where: { id: importId } })

  await prisma.import.update({ where: { id: importId }, data: { status: 'PROCESSING' } })

  try {
    const buffer = Buffer.from(await file.arrayBuffer())

    switch (importRecord.sourceType) {
      case 'EXCEL':
      case 'CSV':
        return await processSpreadsheet(importId, buffer)
      case 'PDF':
        return await processPdf(importId, buffer)
      case 'IMAGE':
        return await processImage(importId, file, sourceHint === 'invoice')
    }
  } catch (error) {
    await prisma.import.update({
      where: { id: importId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Import processing failed',
        completedAt: new Date(),
      },
    })
    return {}
  }
}

async function processSpreadsheet(importId: string, buffer: Buffer): Promise<ProcessResult> {
  const { headers, rows } = parseSpreadsheet(buffer)

  if (rows.length === 0) {
    await prisma.import.update({
      where: { id: importId },
      data: { status: 'FAILED', errorMessage: 'No rows found in this file', completedAt: new Date() },
    })
    return {}
  }

  await prisma.importRow.createMany({
    data: rows.map((row) => ({ importId, rawData: row })),
  })

  const { mapping: mappingSuggestion, regionSplitColumns, countryStateSplitColumns } = await suggestColumnMapping(headers, rows.slice(0, 3))

  await prisma.import.update({
    where: { id: importId },
    data: { status: 'REVIEW', recordCount: rows.length },
  })

  return { mappingSuggestion, regionSplitColumns, countryStateSplitColumns }
}

async function processPdf(importId: string, buffer: Buffer): Promise<ProcessResult> {
  const pages = await extractPdfPages(buffer)
  const extracted = await extractWinesFromPdf(pages, PDF_PAGE_BATCH_SIZE)

  if (extracted.length === 0) {
    await prisma.import.update({
      where: { id: importId },
      data: {
        status: 'FAILED',
        errorMessage: 'Could not find any wine line items in this PDF',
        completedAt: new Date(),
      },
    })
    return {}
  }

  await prisma.importRow.createMany({
    data: extracted.map((row) => ({
      importId,
      rawData: row.mappedData as unknown as Prisma.InputJsonValue,
      mappedData: row.mappedData as unknown as Prisma.InputJsonValue,
      confidenceScores: row.confidenceScores as unknown as Prisma.InputJsonValue,
    })),
  })

  await prisma.import.update({
    where: { id: importId },
    data: { status: 'REVIEW', recordCount: extracted.length },
  })

  return {}
}

function decodeTransferEncoding(body: string, encoding: string): string {
  const enc = encoding.trim().toLowerCase()
  if (enc === 'quoted-printable') {
    return body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  }
  if (enc === 'base64') {
    try { return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8') } catch { return body }
  }
  return body
}

function extractTextFromMime(raw: string): string {
  const boundaryMatch = raw.match(/boundary=["']?([^"'\r\n;]+)["']?/i)
  if (!boundaryMatch) return raw
  const boundary = boundaryMatch[1].trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = raw.split(new RegExp(`--${boundary}(?:--)?\\r?\\n?`))
  let htmlContent: string | null = null
  let textContent: string | null = null
  for (const part of parts) {
    const headerEnd = part.search(/\r?\n\r?\n/)
    if (headerEnd < 0) continue
    const headers = part.slice(0, headerEnd)
    const body = part.slice(headerEnd).trimStart()
    const ct = headers.match(/Content-Type:\s*([^\r\n;]+)/i)?.[1]?.trim().toLowerCase() ?? ''
    const enc = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i)?.[1] ?? '7bit'
    const decoded = decodeTransferEncoding(body, enc)
    if (ct.startsWith('text/html') && !htmlContent) htmlContent = decoded
    else if (ct.startsWith('text/plain') && !textContent) textContent = decoded
  }
  return htmlContent ?? textContent ?? raw
}

const STRUCTURED_MIME_TYPES = new Set([
  'message/rfc822', 'multipart/related', 'application/x-mimearchive',
])

async function processImage(importId: string, file: File, isInvoice = false): Promise<ProcessResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const isStructuredMime = STRUCTURED_MIME_TYPES.has(file.type) || ext === 'mhtml' || ext === 'eml'
  const isHtml = isStructuredMime || file.type === 'text/html' || /\.html?$/i.test(file.name)

  if (isHtml) {
    const raw = await file.text()
    const html = isStructuredMime ? extractTextFromMime(raw) : raw
    const extracted = await extractWinesFromText(html)


    if (extracted.length === 0) {
      await prisma.import.update({
        where: { id: importId },
        data: {
          status: 'FAILED',
          errorMessage: 'Could not find any wine line items in this file',
          completedAt: new Date(),
        },
      })
      return {}
    }

    await prisma.importRow.createMany({
      data: extracted.map((row) => ({
        importId,
        rawData: row.mappedData as unknown as Prisma.InputJsonValue,
        mappedData: row.mappedData as unknown as Prisma.InputJsonValue,
        confidenceScores: row.confidenceScores as unknown as Prisma.InputJsonValue,
      })),
    })

    await prisma.import.update({
      where: { id: importId },
      data: { status: 'REVIEW', recordCount: extracted.length },
    })

    return {}
  }

  const { base64, mimeType } = await fileToBase64(file)

  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
    await prisma.import.update({
      where: { id: importId },
      data: { status: 'FAILED', errorMessage: 'Unsupported image type for extraction', completedAt: new Date() },
    })
    return {}
  }

  const extracted = isInvoice
    ? await extractWinesFromInvoiceImage(base64, mimeType)
    : await extractWinesFromImage(base64, mimeType)

  if (extracted.length === 0) {
    await prisma.importRow.create({
      data: { importId, rawData: {}, mappedData: {}, confidenceScores: {} },
    })

    await prisma.import.update({
      where: { id: importId },
      data: {
        status: 'REVIEW',
        recordCount: 1,
        errorMessage:
          'Could not identify wine details from this image — fill in the fields manually before confirming.',
      },
    })

    return {}
  }

  await prisma.importRow.createMany({
    data: extracted.map((row) => ({
      importId,
      rawData: row.mappedData as unknown as Prisma.InputJsonValue,
      mappedData: row.mappedData as unknown as Prisma.InputJsonValue,
      confidenceScores: row.confidenceScores as unknown as Prisma.InputJsonValue,
    })),
  })

  await prisma.import.update({
    where: { id: importId },
    data: { status: 'REVIEW', recordCount: extracted.length },
  })

  return {}
}
