import Link from 'next/link'
import type { Import } from '@prisma/client'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnMappingForm } from './ColumnMappingForm'
import { ImportRowTable, type ImportRowWithDuplicate } from './ImportRowTable'
import { MatchConsumedReview } from './MatchConsumedReview'
import { ResetMappingButton } from './ResetMappingButton'

interface ImportReviewProps {
  importRecord: Import
  rows: ImportRowWithDuplicate[]
  mappingSuggestion: Record<string, string | null>
  regionSplitColumns?: Record<string, string>
  countryStateSplitColumns?: Record<string, string>
  isHistoricalImport?: boolean
  showMergeBanner?: boolean
  mergeMatchCount?: number
  totalRowCount?: number
}

export function ImportReview({ importRecord, rows, mappingSuggestion, regionSplitColumns, countryStateSplitColumns, isHistoricalImport, showMergeBanner, mergeMatchCount, totalRowCount }: ImportReviewProps) {
  if (importRecord.status === 'FAILED') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-2">
          <p className="font-medium text-foreground">This import failed</p>
          <p className="text-sm text-muted-foreground">
            {importRecord.errorMessage || 'Something went wrong while processing this file.'}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/import">Try another file</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (importRecord.status === 'COMPLETE') {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-2">
          <p className="font-medium text-foreground">This import is complete</p>
          <p className="text-sm text-muted-foreground">
            {importRecord.recordCount} wine{importRecord.recordCount === 1 ? '' : 's'} added to your
            cellar
            {importRecord.skippedCount > 0 ? `, ${importRecord.skippedCount} skipped` : ''}.
          </p>
          <Button asChild size="sm">
            <Link href="/dashboard/cellar">Go to cellar</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (importRecord.status === 'PENDING' || importRecord.status === 'PROCESSING') {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        This import is still processing. Refresh this page in a moment.
      </div>
    )
  }

  const needsMapping = rows.some((row) => row.mappedData === null)

  if (needsMapping) {
    const firstRow = rows[0]
    const rawData = (firstRow?.rawData ?? {}) as unknown as Record<string, string>
    const headers = Object.keys(rawData)

    return (
      <ColumnMappingForm
        importId={importRecord.id}
        headers={headers}
        sampleRow={rawData}
        suggestion={mappingSuggestion}
        regionSplitColumns={regionSplitColumns}
        countryStateSplitColumns={countryStateSplitColumns}
      />
    )
  }

  const errorBanner = importRecord.errorMessage ? (
    <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{importRecord.errorMessage}</p>
    </div>
  ) : null

  const mergeBanner = showMergeBanner ? (
    <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-sm text-amber-900 dark:text-amber-200">
        This looks like a duplicate import — {mergeMatchCount} of {totalRowCount} wines already
        exist in your cellar. We&apos;ll combine quantities and fill in missing data rather than
        creating duplicates.
      </p>
    </div>
  ) : null

  if (importRecord.importType === 'MATCH_CONSUMED') {
    return (
      <div className="space-y-4">
        <ResetMappingButton importId={importRecord.id} />
        {errorBanner}
        <MatchConsumedReview importId={importRecord.id} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ResetMappingButton importId={importRecord.id} />
      {errorBanner}
      {mergeBanner}
      <ImportRowTable importId={importRecord.id} rows={rows} isHistoricalImport={isHistoricalImport} />
    </div>
  )
}
