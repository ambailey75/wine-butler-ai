import './pdf-polyfill'
import { PDFParse } from 'pdf-parse'
import { MAX_PDF_PAGES } from './constants'

// Extracts per-page text from a PDF, capped at MAX_PDF_PAGES (CLAUDE.md limit).
export async function extractPdfPages(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText({ first: MAX_PDF_PAGES })
    return result.pages.map((page) => page.text)
  } finally {
    await parser.destroy()
  }
}
