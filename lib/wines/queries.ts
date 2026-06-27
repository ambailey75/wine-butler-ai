import { prisma } from '@/lib/prisma/client'
import type { Wine } from '@prisma/client'

// Prisma returns Decimal fields as Decimal.js instances, which cannot cross
// the server/client component boundary. Use these when passing wines to
// client components (table, form).
export type SerializedWine = Omit<Wine, 'purchasePrice' | 'rating' | 'currentEstValue' | 'totalCostOverride' | 'totalValueOverride'> & {
  purchasePrice: number | null
  rating: number | null
  currentEstValue: number | null
  totalCostOverride: number | null
  totalValueOverride: number | null
}

export function serializeWine(wine: Wine): SerializedWine {
  return {
    ...wine,
    purchasePrice: wine.purchasePrice ? wine.purchasePrice.toNumber() : null,
    rating: wine.rating ? wine.rating.toNumber() : null,
    currentEstValue: wine.currentEstValue ? wine.currentEstValue.toNumber() : null,
    totalCostOverride: wine.totalCostOverride ? wine.totalCostOverride.toNumber() : null,
    totalValueOverride: wine.totalValueOverride ? wine.totalValueOverride.toNumber() : null,
  }
}

export function serializeWines(wines: Wine[]): SerializedWine[] {
  return wines.map(serializeWine)
}

export async function listWines(userId: string): Promise<Wine[]> {
  return prisma.wine.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getWine(userId: string, id: string): Promise<Wine | null> {
  return prisma.wine.findFirst({
    where: { id, userId },
  })
}

export async function getRecentWines(userId: string, limit = 5): Promise<Wine[]> {
  return prisma.wine.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export interface DistinctWineValues {
  regions: string[]
  varietals: string[]
}

export async function getDistinctRegionsAndVarietals(
  userId: string
): Promise<DistinctWineValues> {
  const wines = await prisma.wine.findMany({
    where: { userId },
    select: { region: true, varietal: true },
  })

  const regions = new Set<string>()
  const varietals = new Set<string>()

  for (const wine of wines) {
    if (wine.region) regions.add(wine.region)
    if (wine.varietal) varietals.add(wine.varietal)
  }

  return {
    regions: Array.from(regions).sort(),
    varietals: Array.from(varietals).sort(),
  }
}

export interface EstimatedValue {
  perBottle: number | null
  isApproximate: boolean
}

export function getEstimatedValue(currentEstValue: number | null, purchasePrice: number | null): EstimatedValue {
  if (currentEstValue !== null) return { perBottle: currentEstValue, isApproximate: false }
  if (purchasePrice !== null) return { perBottle: purchasePrice, isApproximate: true }
  return { perBottle: null, isApproximate: false }
}

export interface DrinkSoonWine {
  id: string
  producer: string
  wineName: string
  vintage: number | null
  drinkWindowEnd: number
}

export interface DashboardSummary {
  totalBottles: number
  totalCostBasis: number
  totalCurrentValue: number
  netGainLoss: number
  netGainLossPercent: number | null
  bottlesAtPeak: number
  drinkSoonCount: number
  drinkSoonWines: DrinkSoonWine[]
}

export async function getDashboardSummary(userId: string): Promise<DashboardSummary> {
  const wines = await prisma.wine.findMany({
    where: { userId },
    select: {
      quantity: true,
      purchasePrice: true,
      currentEstValue: true,
      totalCostOverride: true,
      totalValueOverride: true,
    },
  })

  const totalBottles = wines.reduce((sum, w) => sum + w.quantity, 0)

  const totalCostBasis = wines.reduce((sum, w) => {
    if (w.totalCostOverride) return sum + w.totalCostOverride.toNumber()
    if (w.purchasePrice) return sum + w.purchasePrice.toNumber() * w.quantity
    return sum
  }, 0)

  const totalCurrentValue = wines.reduce((sum, w) => {
    if (w.totalValueOverride) return sum + w.totalValueOverride.toNumber()
    if (w.currentEstValue) return sum + w.currentEstValue.toNumber() * w.quantity
    if (w.purchasePrice) return sum + w.purchasePrice.toNumber() * w.quantity
    return sum
  }, 0)

  const netGainLoss = totalCurrentValue - totalCostBasis
  const netGainLossPercent = totalCostBasis > 0 ? (netGainLoss / totalCostBasis) * 100 : null

  const currentYear = new Date().getFullYear()

  const [peakWines, drinkSoonRaw] = await Promise.all([
    prisma.wine.findMany({
      where: {
        userId,
        enrichment: {
          peakWindowStart: { lte: currentYear },
          peakWindowEnd: { gte: currentYear },
        },
      },
      select: { quantity: true },
    }),
    prisma.wine.findMany({
      where: {
        userId,
        isFullyConsumed: false,
        drinkWindowEnd: { lte: currentYear + 2 },
      },
      orderBy: { drinkWindowEnd: 'asc' },
      select: { id: true, producer: true, wineName: true, vintage: true, drinkWindowEnd: true },
    }),
  ])

  const bottlesAtPeak = peakWines.reduce((sum, w) => sum + w.quantity, 0)
  const drinkSoonCount = drinkSoonRaw.length
  const drinkSoonWines: DrinkSoonWine[] = drinkSoonRaw.slice(0, 3).map((w) => ({
    id: w.id,
    producer: w.producer,
    wineName: w.wineName,
    vintage: w.vintage,
    drinkWindowEnd: w.drinkWindowEnd as number,
  }))

  return { totalBottles, totalCostBasis, totalCurrentValue, netGainLoss, netGainLossPercent, bottlesAtPeak, drinkSoonCount, drinkSoonWines }
}

export async function getRecentConsumptionLogs(userId: string, limit = 5) {
  return prisma.consumptionLog.findMany({
    where: { userId },
    include: { wine: { select: { producer: true, wineName: true, vintage: true } } },
    orderBy: { consumedDate: 'desc' },
    take: limit,
  })
}

export async function getConsumptionLogs(wineId: string) {
  return prisma.consumptionLog.findMany({
    where: { wineId },
    orderBy: { consumedDate: 'desc' },
  })
}
