import { findMergeMatches } from '@/lib/import/find-merge-match'
import type { MappedWineData } from '@/lib/import/constants'

jest.mock('@/lib/prisma/client', () => ({
  prisma: {
    wine: { findMany: jest.fn() },
  },
}))

const { prisma } = jest.requireMock('@/lib/prisma/client') as {
  prisma: { wine: { findMany: jest.Mock } }
}

const USER_ID = 'user-123'

function makeExistingWine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wine-1',
    producer: 'Opus One',
    wineName: 'Opus One',
    vintage: 2019,
    format: '750mL',
    storageLocation: null,
    quantity: 6,
    consumedQuantity: 0,
    isFullyConsumed: false,
    country: null,
    state: null,
    region: null,
    subRegion: null,
    vineyard: null,
    classification: null,
    varietal: null,
    style: null,
    vendor: null,
    purchasePrice: null,
    purchaseDate: null,
    currentEstValue: null,
    totalCostOverride: null,
    totalValueOverride: null,
    rating: null,
    drinkWindowStart: null,
    drinkWindowEnd: null,
    tastingNotes: null,
    pairingNotes: null,
    ...overrides,
  }
}

describe('findMergeMatches', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns "new" for a candidate with no identity match', async () => {
    prisma.wine.findMany.mockResolvedValue([])

    const candidates: MappedWineData[] = [
      { producer: 'Caymus', wineName: 'Special Selection', vintage: 2018 },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result).toEqual([{ type: 'new' }])
  })

  it('returns "merge" when producer/wineName/vintage/format/storageLocation all match', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine({ storageLocation: 'Rack 1' })])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '750mL', storageLocation: 'Rack 1' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0]).toMatchObject({ type: 'merge', wineId: 'wine-1' })
  })

  it('matches case-insensitively', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine()])

    const candidates: MappedWineData[] = [
      { producer: 'opus one', wineName: 'opus one', vintage: 2019, format: '750ML' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0].type).toBe('merge')
  })

  it('returns "merge" when both storage locations are blank', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine({ storageLocation: null })])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '750mL' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0].type).toBe('merge')
  })

  it('returns "merge" when the existing wine has a location and the import specifies none', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine({ storageLocation: 'Rack 1' })])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '750mL' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0].type).toBe('merge')
  })

  it('returns "needs-decision" when the existing wine has no location but the import does', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine({ storageLocation: null, quantity: 4 })])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '750mL', storageLocation: 'Rack 2' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0]).toMatchObject({
      type: 'needs-decision',
      wineId: 'wine-1',
      importedLocation: 'Rack 2',
    })
    if (result[0].type === 'needs-decision') {
      expect(result[0].existing.quantity).toBe(4)
    }
  })

  it('returns "new" when both sides have different non-blank storage locations', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine({ storageLocation: 'Rack 1' })])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '750mL', storageLocation: 'Rack 2' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0].type).toBe('new')
  })

  it('does not match a different vintage', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine()])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2020, format: '750mL' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0].type).toBe('new')
  })

  it('does not match a different format', async () => {
    prisma.wine.findMany.mockResolvedValue([makeExistingWine({ format: '750mL' })])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '1.5L' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0].type).toBe('new')
  })

  it('returns all "new" for an empty cellar', async () => {
    prisma.wine.findMany.mockResolvedValue([])

    const candidates: MappedWineData[] = [
      { producer: 'Caymus', wineName: 'Special Selection', vintage: 2018 },
      { producer: 'Silver Oak', wineName: 'Alexander Valley', vintage: 2019 },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result).toEqual([{ type: 'new' }, { type: 'new' }])
  })

  it('carries the existing wine snapshot for the blank-fill diff', async () => {
    prisma.wine.findMany.mockResolvedValue([
      makeExistingWine({ region: 'Napa Valley', rating: { toNumber: () => 94 } }),
    ])

    const candidates: MappedWineData[] = [
      { producer: 'Opus One', wineName: 'Opus One', vintage: 2019, format: '750mL' },
    ]

    const result = await findMergeMatches(USER_ID, candidates)

    expect(result[0]).toMatchObject({
      type: 'merge',
      existing: expect.objectContaining({ region: 'Napa Valley', rating: 94 }),
    })
  })
})
