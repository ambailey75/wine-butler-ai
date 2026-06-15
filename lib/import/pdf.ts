import './pdf-polyfill'
// Pre-register the worker message handler so pdf.js's Node "fake worker"
// setup finds it on globalThis instead of dynamically importing
// "./pdf.worker.mjs" relative to the bundled route file (which doesn't
// exist in the serverless output and throws "Setting up fake worker failed").
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
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
