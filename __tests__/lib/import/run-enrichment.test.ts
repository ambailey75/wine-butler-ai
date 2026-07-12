import { runEnrichment } from '@/lib/import/run-enrichment'
import type { EnrichableRow } from '@/lib/import/enrich-from-static'

const mockEnrichFromStaticDataset = jest.fn()
const mockEnrichFromClaude = jest.fn()
const mockEnrichRatings = jest.fn()

jest.mock('@/lib/import/enrich-from-static', () => ({
  enrichFromStaticDataset: (...args: unknown[]) => mockEnrichFromStaticDataset(...args),
}))

jest.mock('@/lib/import/enrich-from-claude', () => ({
  enrichFromClaude: (...args: unknown[]) => mockEnrichFromClaude(...args),
}))

jest.mock('@/lib/import/enrich-rating', () => ({
  enrichRatings: (...args: unknown[]) => mockEnrichRatings(...args),
}))

const mockNormalizeWineData = jest.fn()

jest.mock('@/lib/wines/normalize', () => ({
  normalizeWineData: (...args: unknown[]) => mockNormalizeWineData(...args),
}))

function makeRow(mappedData: Record<string, unknown> = {}): EnrichableRow {
  return { mappedData, confidenceScores: {} }
}

describe('runEnrichment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockNormalizeWineData.mockImplementation((mappedData) => mappedData)
    mockEnrichFromStaticDataset.mockImplementation((rows) => rows)
    mockEnrichFromClaude.mockImplementation(async (rows) => rows)
    mockEnrichRatings.mockImplementation(async (rows) => rows)
  })

  it('runs static then Claude enrichment for Layer 1 (pre-review), never touching rating', async () => {
    const rows = [makeRow({ producer: 'A', wineName: 'B' })]

    await runEnrichment(rows, { layer: 'pre-review' })

    expect(mockEnrichFromStaticDataset).toHaveBeenCalledWith(rows, expect.not.arrayContaining(['rating']))
    expect(mockEnrichFromClaude).toHaveBeenCalled()
    expect(mockEnrichRatings).not.toHaveBeenCalled()
  })

  it('normalizes every row before any enrichment call runs', async () => {
    const rows = [makeRow({ producer: 'A', wineName: 'B', varietal: 'cab' })]
    const callOrder: string[] = []
    mockNormalizeWineData.mockImplementation((mappedData) => {
      callOrder.push('normalize')
      return mappedData
    })
    mockEnrichFromStaticDataset.mockImplementation((r) => {
      callOrder.push('static')
      return r
    })
    mockEnrichFromClaude.mockImplementation(async (r) => {
      callOrder.push('claude')
      return r
    })

    await runEnrichment(rows, { layer: 'pre-review' })

    expect(mockNormalizeWineData).toHaveBeenCalledWith(rows[0].mappedData)
    expect(callOrder).toEqual(['normalize', 'static', 'claude'])
  })

  it('runs the rating cascade only when fields includes rating (Layer 2/3)', async () => {
    const rows = [makeRow({ producer: 'A', wineName: 'B' })]

    await runEnrichment(rows, { layer: 'pre-confirm', fields: ['country', 'rating'] })

    expect(mockEnrichRatings).toHaveBeenCalled()
    // rating must never be passed to the generic static/Claude fields param
    expect(mockEnrichFromStaticDataset.mock.calls[0][1]).not.toContain('rating')
    expect(mockEnrichFromClaude.mock.calls[0][1]).not.toContain('rating')
  })

  it('does not run the rating cascade for post-confirm without rating in fields', async () => {
    const rows = [makeRow({ producer: 'A', wineName: 'B' })]

    await runEnrichment(rows, { layer: 'post-confirm', fields: ['country'] })

    expect(mockEnrichRatings).not.toHaveBeenCalled()
  })

  it('never throws — returns the original rows unchanged if any stage fails', async () => {
    mockEnrichFromClaude.mockRejectedValue(new Error('Claude is down'))
    const rows = [makeRow({ producer: 'A', wineName: 'B' })]

    const result = await runEnrichment(rows, { layer: 'pre-review' })

    expect(result).toBe(rows)
  })

  it('never throws when the rating cascade fails', async () => {
    mockEnrichRatings.mockRejectedValue(new Error('Vivino and Claude both down'))
    const rows = [makeRow({ producer: 'A', wineName: 'B' })]

    const result = await runEnrichment(rows, { layer: 'pre-confirm', fields: ['rating'] })

    expect(result).toBe(rows)
  })

  it('chunks a large row set into multiple Claude calls instead of one unbounded call', async () => {
    const rows = Array.from({ length: 320 }, (_, i) => makeRow({ producer: `P${i}`, wineName: `W${i}` }))

    await runEnrichment(rows, { layer: 'pre-review' })

    // 320 rows / 150-row chunks = 3 calls
    expect(mockEnrichFromClaude).toHaveBeenCalledTimes(3)
  })

  it('makes a single Claude call for a row set under the chunk size', async () => {
    const rows = [makeRow({ producer: 'A', wineName: 'B' })]

    await runEnrichment(rows, { layer: 'pre-review' })

    expect(mockEnrichFromClaude).toHaveBeenCalledTimes(1)
  })
})
