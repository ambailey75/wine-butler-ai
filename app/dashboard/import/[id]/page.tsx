import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Clock, Users } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getImport } from '@/lib/import/queries'
import { findMergeMatches } from '@/lib/import/find-merge-match'
import { type MappedWineData } from '@/lib/import/constants'
import { ImportStatusBadge } from '@/components/import/ImportStatusBadge'
import { ImportReview } from '@/components/import/ImportReview'

interface ImportReviewPageProps {
  params: { id: string }
  searchParams: { [key: string]: string | string[] | undefined }
}

export default async function ImportReviewPage({ params, searchParams }: ImportReviewPageProps) {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  const importRecord = await getImport(user.id, params.id)
  if (!importRecord) {
    notFound()
  }

  const candidates = importRecord.rows.map(
    (row) => (row.mappedData ?? {}) as unknown as MappedWineData
  )
  const mergeOutcomes = await findMergeMatches(user.id, candidates)
  const mergeMatchCount = mergeOutcomes.filter((o) => o.type !== 'new').length
  const showMergeBanner = importRecord.rows.length > 0 && mergeMatchCount / importRecord.rows.length > 0.5

  const rows = importRecord.rows.map((row, index) => {
    const scores = (row.confidenceScores ?? {}) as Record<string, unknown>
    const enrichedSources: Record<string, string> = {}
    for (const [key, val] of Object.entries(scores)) {
      if (key.startsWith('_src_') && typeof val === 'string') {
        enrichedSources[key.slice(5)] = val
      }
    }
    return { ...row, mergeOutcome: mergeOutcomes[index], enrichedSources }
  })

  const mappingParam = searchParams.mapping
  let mappingSuggestion: Record<string, string | null> = {}
  if (typeof mappingParam === 'string') {
    try {
      mappingSuggestion = JSON.parse(mappingParam)
    } catch {
      mappingSuggestion = {}
    }
  }

  const regionSplitsParam = searchParams.regionSplits
  let regionSplitColumns: Record<string, string> = {}
  if (typeof regionSplitsParam === 'string') {
    try {
      regionSplitColumns = JSON.parse(regionSplitsParam)
    } catch {
      regionSplitColumns = {}
    }
  }

  const countryStateSplitsParam = searchParams.countryStateSplits
  let countryStateSplitColumns: Record<string, string> = {}
  if (typeof countryStateSplitsParam === 'string') {
    try {
      countryStateSplitColumns = JSON.parse(countryStateSplitsParam)
    } catch {
      countryStateSplitColumns = {}
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/import/history"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All imports
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{importRecord.originalFilename}</h1>
          <ImportStatusBadge status={importRecord.status} />
        </div>
      </div>

      {importRecord.importType === 'HISTORICAL_CONSUMED' && (
        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-foreground">Historical import</p>
            <p className="text-sm text-muted-foreground">
              All wines will be marked as consumed and added to your drinking history
              {importRecord.historicalConsumedDate
                ? ` (consumed date: ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(importRecord.historicalConsumedDate)})`
                : ''}
            </p>
          </div>
        </div>
      )}
      {importRecord.importType === 'MATCH_CONSUMED' && (
        <div className="flex items-start gap-3 rounded-md border border-secondary/30 bg-secondary/5 p-4">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-secondary" />
          <div>
            <p className="font-medium text-foreground">Match and consume</p>
            <p className="text-sm text-muted-foreground">
              Each row will be matched against wines in your cellar. You confirm every match before anything changes.
            </p>
          </div>
        </div>
      )}

      <ImportReview
        importRecord={importRecord}
        rows={rows}
        mappingSuggestion={mappingSuggestion}
        regionSplitColumns={regionSplitColumns}
        countryStateSplitColumns={countryStateSplitColumns}
        isHistoricalImport={importRecord.isHistoricalImport}
        showMergeBanner={showMergeBanner}
        mergeMatchCount={mergeMatchCount}
        totalRowCount={importRecord.rows.length}
      />
    </div>
  )
}
