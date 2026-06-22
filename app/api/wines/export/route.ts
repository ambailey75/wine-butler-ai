import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/current-user'
import { prisma } from '@/lib/prisma/client'
import { getEstimatedValue } from '@/lib/wines/queries'

function escapeCSV(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const HEADERS = [
  'Producer', 'Wine Name', 'Vintage', 'Country', 'State/Province', 'Region',
  'Sub-Region', 'Vineyard', 'Classification', 'Varietal', 'Style', 'Format',
  'Quantity', 'Purchase Price', 'Current Est. Value', 'Total Cost',
  'Total Est. Value', 'Purchase Date', 'Vendor', 'Storage Location',
  'Drink Window Start', 'Drink Window End', 'Rating', 'Tasting Notes',
  'Pairing Notes', 'Notes', 'Wine ID', 'Consumed', 'Fully Consumed',
]

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const wines = await prisma.wine.findMany({
    where: { userId: user.id },
    orderBy: { producer: 'asc' },
  })

  const rows = wines.map((w) => {
    const purchasePrice = w.purchasePrice ? w.purchasePrice.toNumber() : null
    const currentEstValue = w.currentEstValue ? w.currentEstValue.toNumber() : null
    const totalCostOverride = w.totalCostOverride ? w.totalCostOverride.toNumber() : null
    const totalValueOverride = w.totalValueOverride ? w.totalValueOverride.toNumber() : null
    const totalCost = totalCostOverride ?? (purchasePrice !== null ? purchasePrice * w.quantity : null)
    const estValue = getEstimatedValue(currentEstValue, purchasePrice)
    const totalValue = totalValueOverride ?? (estValue.perBottle !== null ? estValue.perBottle * w.quantity : null)
    const rating = w.rating ? w.rating.toNumber() : null

    return [
      w.producer, w.wineName, w.vintage, w.country, w.state, w.region,
      w.subRegion, w.vineyard, w.classification, w.varietal, w.style, w.format,
      w.quantity, purchasePrice, estValue.perBottle, totalCost,
      totalValue, w.purchaseDate?.toISOString().split('T')[0], w.vendor,
      w.storageLocation, w.drinkWindowStart, w.drinkWindowEnd, rating,
      w.tastingNotes, w.pairingNotes, w.notes, w.wineId,
      w.consumedQuantity, w.isFullyConsumed ? 'Yes' : 'No',
    ].map((v) => escapeCSV(v?.toString())).join(',')
  })

  const csv = [HEADERS.join(','), ...rows].join('\n')
  const date = new Date().toISOString().split('T')[0]

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="wine-butler-export-${date}.csv"`,
    },
  })
}
