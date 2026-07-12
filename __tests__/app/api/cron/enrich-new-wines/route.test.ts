import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/enrich-new-wines/route'

jest.mock('@/lib/cron/auth', () => ({
  verifyCronSecret: jest.fn(),
}))

const mockFindMany = jest.fn()
const mockUpdate = jest.fn()

jest.mock('@/lib/prisma/client', () => ({
  prisma: {
    wine: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}))

const mockRunEnrichment = jest.fn()

jest.mock('@/lib/import/run-enrichment', () => ({
  runEnrichment: (...args: unknown[]) => mockRunEnrichment(...args),
}))

jest.mock('@/lib/wines/normalize', () => ({
  normalizeWineData: (mappedData: unknown) => mappedData,
}))

const { verifyCronSecret } = jest.requireMock('@/lib/cron/auth') as { verifyCronSecret: jest.Mock }

function makeWine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wine-1',
    country: null,
    state: null,
    region: 'Napa Valley',
    subRegion: null,
    appellation: null,
    vineyard: null,
    classification: null,
    varietal: null,
    style: null,
    drinkWindowStart: null,
    drinkWindowEnd: null,
    rating: null,
    ...overrides,
  }
}

function makeRequest() {
  return new NextRequest('http://localhost/api/cron/enrich-new-wines', {
    headers: { authorization: 'Bearer test-secret' },
  })
}

describe('GET /api/cron/enrich-new-wines', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdate.mockResolvedValue({})
  })

  it('returns 401 when the cron secret is invalid', async () => {
    verifyCronSecret.mockReturnValue(false)

    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('fills blank fields returned by enrichment and updates the wine', async () => {
    verifyCronSecret.mockReturnValue(true)
    const wine = makeWine({ subRegion: null })
    mockFindMany.mockResolvedValue([wine])
    mockRunEnrichment.mockResolvedValue([
      { mappedData: { region: 'Napa Valley', subRegion: 'Oakville' }, confidenceScores: {} },
    ])

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'wine-1' },
      data: { subRegion: 'Oakville' },
    })
    expect(body.processed).toBe(1)
    expect(body.fieldsFilled).toBe(1)
  })

  it('never overwrites a field that already has a value', async () => {
    verifyCronSecret.mockReturnValue(true)
    const wine = makeWine({ subRegion: 'Existing Value' })
    mockFindMany.mockResolvedValue([wine])
    mockRunEnrichment.mockResolvedValue([
      { mappedData: { region: 'Napa Valley', subRegion: 'Some Different Value' }, confidenceScores: {} },
    ])

    await GET(makeRequest())

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('skips the update call entirely when nothing new was filled', async () => {
    verifyCronSecret.mockReturnValue(true)
    const wine = makeWine()
    mockFindMany.mockResolvedValue([wine])
    mockRunEnrichment.mockResolvedValue([{ mappedData: {}, confidenceScores: {} }])

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(body.fieldsFilled).toBe(0)
  })

  it('continues processing other wines and reports a failure count when one update rejects', async () => {
    verifyCronSecret.mockReturnValue(true)
    const wines = [makeWine({ id: 'wine-1' }), makeWine({ id: 'wine-2' })]
    mockFindMany.mockResolvedValue(wines)
    mockRunEnrichment.mockResolvedValue([
      { mappedData: { subRegion: 'Oakville' }, confidenceScores: {} },
      { mappedData: { subRegion: 'Rutherford' }, confidenceScores: {} },
    ])
    mockUpdate.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('db error'))

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body.processed).toBe(2)
    expect(body.failed).toBe(1)
  })

  it('returns zero processed when there are no recent wines', async () => {
    verifyCronSecret.mockReturnValue(true)
    mockFindMany.mockResolvedValue([])

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body.processed).toBe(0)
    expect(mockRunEnrichment).not.toHaveBeenCalled()
  })
})
