import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Wine } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getDashboardSummary, getRecentWines, getRecentConsumptionLogs } from '@/lib/wines/queries'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { RecentWines } from '@/components/dashboard/RecentWines'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  const summary = await getDashboardSummary(user.id)

  if (summary.totalBottles === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold text-foreground">
          Welcome to your cellar
        </h1>
        <div className="relative overflow-hidden rounded-xl" style={{ minHeight: '440px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Image
            src="/images/cellar-tunnel.png"
            alt="Wine cellar"
            fill
            className="object-cover"
            priority
          />
          <div className="absolute inset-0" style={{ background: 'rgba(45, 27, 30, 0.68)' }} />
          <div
            className="relative z-10 flex flex-col items-center justify-center px-8 py-12 text-center"
            style={{
              maxWidth: '380px',
              background: 'rgba(255, 255, 255, 0.92)',
              borderRadius: '14px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
            }}
          >
            <Wine className="mb-4 h-10 w-10 text-secondary" />
            <h2 className="text-lg font-semibold text-foreground">Your cellar is empty</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Add your first bottle to start tracking your collection, or import your existing cellar.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild>
                <Link href="/dashboard/cellar/new">Add a wine</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard/import">Import your collection</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const [recentWines, recentConsumption] = await Promise.all([
    getRecentWines(user.id, 5),
    getRecentConsumptionLogs(user.id, 5),
  ])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Bottles" value={summary.totalBottles.toLocaleString()} />
        <KpiCard
          label="Total Cost Basis"
          value={formatCurrency(summary.totalCostBasis)}
        />
        <KpiCard
          label="Total Current Value"
          value={formatCurrency(summary.totalCurrentValue)}
        />
        <KpiCard
          label="Net Gain/Loss"
          value={
            <span className={summary.netGainLoss >= 0 ? 'text-emerald-500' : 'text-red-500'}>
              {formatCurrency(summary.netGainLoss)}
              {summary.netGainLossPercent !== null && (
                <span className="ml-1 text-sm font-normal">
                  ({formatPercent(summary.netGainLossPercent)})
                </span>
              )}
            </span>
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Bottles at Peak"
          value={summary.bottlesAtPeak.toLocaleString()}
          caption="Updates once enrichment runs"
        />
        <Link href="/dashboard/cellar" className="block">
          <KpiCard
            label="Drink Soon"
            value={
              <span className={summary.drinkSoonCount > 0 ? 'text-amber-500' : undefined}>
                {summary.drinkSoonCount.toLocaleString()}
              </span>
            }
            caption="Within the next 2 years"
            className={summary.drinkSoonCount > 0 ? 'ring-1 ring-amber-300/40 hover:ring-amber-400/60 transition-shadow' : undefined}
          />
        </Link>
      </div>
      {summary.drinkSoonWines.length > 0 && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/30 p-4">
          <p className="mb-3 text-sm font-semibold text-amber-800">Drink soon</p>
          <ul className="space-y-2">
            {summary.drinkSoonWines.map((wine) => (
              <li key={wine.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">
                  {wine.producer} {wine.wineName}
                  {wine.vintage ? ` (${wine.vintage})` : ''}
                </span>
                <span className="text-amber-700 font-medium">Drink by {wine.drinkWindowEnd}</span>
              </li>
            ))}
          </ul>
          <Link href="/dashboard/cellar" className="mt-3 block text-xs text-amber-700 hover:underline">
            View all in cellar
          </Link>
        </div>
      )}
      {recentWines.length > 0 && <RecentWines wines={recentWines} />}
      {recentConsumption.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently Enjoyed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recentConsumption.map((log) => (
                <li key={log.id} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">
                    {log.wine.producer} {log.wine.wineName}
                    {log.wine.vintage ? ` (${log.wine.vintage})` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {log.occasion ? `${log.occasion} — ` : ''}
                    {formatDate(log.consumedDate)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
