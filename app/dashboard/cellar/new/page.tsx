import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getDistinctRegionsAndVarietals } from '@/lib/wines/queries'
import { WineForm } from '@/components/cellar/WineForm'

export default async function NewWinePage({
  searchParams,
}: {
  searchParams: { producer?: string; wineName?: string; vintage?: string; region?: string; varietal?: string; country?: string }
}) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  const { regions, varietals } = await getDistinctRegionsAndVarietals(user.id)

  const prefill = Object.keys(searchParams).length > 0
    ? {
        producer: searchParams.producer,
        wineName: searchParams.wineName,
        vintage: searchParams.vintage ? Number(searchParams.vintage) : undefined,
        region: searchParams.region,
        varietal: searchParams.varietal,
        country: searchParams.country,
      }
    : undefined

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Add a wine</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only producer, wine name, and quantity are required. Everything else can be
          filled in later.
        </p>
      </div>
      <WineForm mode="create" existingRegions={regions} existingVarietals={varietals} prefill={prefill} />
    </div>
  )
}
