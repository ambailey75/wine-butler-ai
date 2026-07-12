import { enrichRatings } from '@/lib/import/enrich-rating'
import type { EnrichableRow } from '@/lib/import/enrich-from-static'

const mockSearchVivino = jest.fn()

jest.mock('@/lib/wines/vivino', () => ({
  searchVivino: (...args: unknown[]) => mockSearchVivino(...args),
}))

jest.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: { create: jest.fn() },
  },
  CLAUDE_MODEL: 'claude-sonnet-4-6',
}))

const { anthropic } = jest.requireMock('@/lib/ai/client') as {
  anthropic: { messages: { create: jest.Mock } }
}

function toolTextResponse(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function makeRow(mappedData: Record<string, unknown> = {}): EnrichableRow {
  return { mappedData, confidenceScores: {} }
}

describe('enrichRatings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('leaves rows with an existing rating untouched', async () => {
    const rows = [makeRow({ producer: 'Opus One', wineName: 'Opus One', rating: 95 })]

    const result = await enrichRatings(rows)

    expect(mockSearchVivino).not.toHaveBeenCalled()
    expect(result[0].mappedData.rating).toBe(95)
  })

  it('fills rating from Vivino, scaled to 0-100, with a vivino source badge', async () => {
    mockSearchVivino.mockResolvedValue([
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, country: null, region: null, varietal: null, ratingAverage: 4.7 },
    ])
    const rows = [makeRow({ producer: 'Opus One', wineName: 'Opus One', vintage: 2019 })]

    const result = await enrichRatings(rows)

    expect(result[0].mappedData.rating).toBe(94)
    expect(result[0].confidenceScores.rating).toBe(0.8)
    expect(result[0].confidenceScores._src_rating).toBe('vivino')
    expect(anthropic.messages.create).not.toHaveBeenCalled()
  })

  it('falls back to Claude when Vivino has no matching result', async () => {
    mockSearchVivino.mockResolvedValue([])
    anthropic.messages.create.mockResolvedValue(toolTextResponse([{ index: 0, rating: 88 }]))
    const rows = [makeRow({ producer: 'Obscure Producer', wineName: 'Rare Cuvee' })]

    const result = await enrichRatings(rows)

    expect(result[0].mappedData.rating).toBe(88)
    expect(result[0].confidenceScores.rating).toBe(0.6)
    expect(result[0].confidenceScores._src_rating).toBe('ai-estimate')
  })

  it('falls back to Claude when Vivino throws', async () => {
    mockSearchVivino.mockRejectedValue(new Error('Vivino timeout'))
    anthropic.messages.create.mockResolvedValue(toolTextResponse([{ index: 0, rating: 90 }]))
    const rows = [makeRow({ producer: 'Opus One', wineName: 'Opus One' })]

    const result = await enrichRatings(rows)

    expect(result[0].mappedData.rating).toBe(90)
    expect(result[0].confidenceScores._src_rating).toBe('ai-estimate')
  })

  it('falls back to Claude when Vivino returns a result that does not match producer/wineName', async () => {
    mockSearchVivino.mockResolvedValue([
      { producer: 'Totally Different Winery', wineName: 'Unrelated Wine', vintage: 2019, country: null, region: null, varietal: null, ratingAverage: 4.9 },
    ])
    anthropic.messages.create.mockResolvedValue(toolTextResponse([{ index: 0, rating: 85 }]))
    const rows = [makeRow({ producer: 'Opus One', wineName: 'Opus One' })]

    const result = await enrichRatings(rows)

    expect(result[0].mappedData.rating).toBe(85)
    expect(result[0].confidenceScores._src_rating).toBe('ai-estimate')
  })

  it('leaves rating blank when both Vivino and Claude fail', async () => {
    mockSearchVivino.mockRejectedValue(new Error('down'))
    anthropic.messages.create.mockRejectedValue(new Error('down too'))
    const rows = [makeRow({ producer: 'Opus One', wineName: 'Opus One' })]

    const result = await enrichRatings(rows)

    expect(result[0].mappedData.rating).toBeUndefined()
    expect(result[0].confidenceScores.rating).toBeUndefined()
  })

  it('never fills a rating without a source badge', async () => {
    mockSearchVivino.mockResolvedValue([
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, country: null, region: null, varietal: null, ratingAverage: 4.5 },
    ])
    anthropic.messages.create.mockResolvedValue(toolTextResponse([]))
    const rows = [
      makeRow({ producer: 'Opus One', wineName: 'Opus One', vintage: 2019 }),
      makeRow({ producer: 'Unknown Winery', wineName: 'Mystery Blend' }),
    ]
    mockSearchVivino
      .mockResolvedValueOnce([
        { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, country: null, region: null, varietal: null, ratingAverage: 4.5 },
      ])
      .mockResolvedValueOnce([])

    const result = await enrichRatings(rows)

    for (const row of result) {
      if (row.mappedData.rating != null) {
        expect(row.confidenceScores._src_rating).toBeDefined()
      }
    }
  })

  it('does not process rows with a blank producer or wineName', async () => {
    const rows = [makeRow({ producer: '', wineName: '' })]

    const result = await enrichRatings(rows)

    expect(mockSearchVivino).not.toHaveBeenCalled()
    expect(result[0].mappedData.rating).toBeUndefined()
  })
})
