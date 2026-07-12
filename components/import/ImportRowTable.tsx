'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ImportRowStatus } from '@prisma/client'
import { AlertTriangle } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  IMPORT_TARGET_FIELDS,
  LOW_CONFIDENCE_THRESHOLD,
  type ConfidenceScores,
  type MappedWineData,
} from '@/lib/import/constants'
import type { MergeOutcome } from '@/lib/import/find-merge-match'
import type { ImportRow } from '@prisma/client'

export interface ImportRowWithDuplicate extends ImportRow {
  mergeOutcome: MergeOutcome
  enrichedSources?: Record<string, string>
}

type LocationDecision = 'merge' | 'separate'

interface RowState {
  id: string
  mappedData: MappedWineData
  confidenceScores: ConfidenceScores
  status: ImportRowStatus
  mergeOutcome: MergeOutcome
  locationDecision: LocationDecision
  markConsumed: boolean
  enrichedSources: Record<string, string>
}

function toRowState(row: ImportRowWithDuplicate, defaultConsumed: boolean): RowState {
  return {
    id: row.id,
    mappedData: (row.mappedData ?? {}) as unknown as MappedWineData,
    confidenceScores: (row.confidenceScores ?? {}) as unknown as ConfidenceScores,
    status: row.status,
    mergeOutcome: row.mergeOutcome,
    // Safe default — a wine only merges into an existing blank-location
    // record when the user explicitly opts in.
    locationDecision: 'separate',
    markConsumed: defaultConsumed,
    enrichedSources: row.enrichedSources ?? {},
  }
}

interface ImportRowTableProps {
  importId: string
  rows: ImportRowWithDuplicate[]
  isHistoricalImport?: boolean
}

interface ConfirmResult {
  imported: number
  merged: number
  skipped: number
  fallback: number
  failed: number
  errors: Array<{ rowId: string; producer?: string; wineName?: string; error: string }>
}

export function ImportRowTable({ importId, rows, isHistoricalImport }: ImportRowTableProps) {
  const router = useRouter()
  const [rowsState, setRowsState] = useState<RowState[]>(() => rows.map((r) => toRowState(r, !!isHistoricalImport)))
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<{ imported: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConfirmResult | null>(null)

  const missingRequiredRowIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of rowsState) {
      if (row.status === 'SKIPPED') continue
      if (!row.mappedData.producer?.trim() || !row.mappedData.wineName?.trim()) {
        ids.add(row.id)
      }
    }
    return ids
  }, [rowsState])

  // Vintage is never required and never blocks import — this is purely
  // informational, since the app can't reliably guess a missing vintage.
  const missingVintageRowIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of rowsState) {
      if (row.status === 'SKIPPED') continue
      if (!row.mappedData.vintage) {
        ids.add(row.id)
      }
    }
    return ids
  }, [rowsState])

  async function patchRow(rowId: string, body: { mappedData?: MappedWineData; status?: ImportRowStatus }) {
    await fetch(`/api/import/${importId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  function bulkSetStatus(status: 'PENDING' | 'SKIPPED') {
    const snapshot = rowsState
    setRowsState((prev) => prev.map((row) => ({ ...row, status })))
    for (const row of snapshot) {
      if (row.status !== status) {
        void patchRow(row.id, { status })
      }
    }
  }

  function updateField(rowId: string, key: keyof MappedWineData, rawValue: string) {
    const field = IMPORT_TARGET_FIELDS.find((f) => f.key === key)

    setRowsState((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        const mappedData: MappedWineData = { ...row.mappedData }

        if (rawValue === '') {
          delete mappedData[key]
        } else if (field?.type === 'number') {
          const num = Number(rawValue)
          if (!Number.isNaN(num)) {
            ;(mappedData as Record<string, unknown>)[key] = num
          }
        } else {
          ;(mappedData as Record<string, unknown>)[key] = rawValue
        }

        return { ...row, mappedData }
      })
    )
  }

  function handleBlur(rowId: string) {
    const row = rowsState.find((r) => r.id === rowId)
    if (!row) return
    void patchRow(rowId, { mappedData: row.mappedData })
  }

  function handleStatusChange(rowId: string, status: ImportRowStatus) {
    setRowsState((prev) => prev.map((row) => (row.id === rowId ? { ...row, status } : row)))
    void patchRow(rowId, { status })
  }

  async function handleConfirm() {
    setConfirming(true)
    setError(null)
    setProgress(null)
    setResult(null)

    try {
      const consumedRowIds = rowsState.filter((r) => r.markConsumed && r.status !== 'SKIPPED').map((r) => r.id)
      const locationDecisions: Record<string, LocationDecision> = {}
      for (const row of rowsState) {
        if (row.mergeOutcome.type === 'needs-decision') {
          locationDecisions[row.id] = row.locationDecision
        }
      }
      const res = await fetch(`/api/import/${importId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumedRowIds, locationDecisions }),
      })

      if (res.headers.get('content-type')?.includes('application/json')) {
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(body?.error || 'Could not confirm import')
        }
        router.push('/dashboard/cellar')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.type === 'progress') {
              setProgress({ imported: msg.imported, total: msg.total })
            } else if (msg.type === 'complete') {
              if (typeof msg.failed === 'number' && msg.failed > 0) {
                setConfirming(false)
                setProgress(null)
                setResult({
                  imported: msg.imported ?? 0,
                  merged: msg.merged ?? 0,
                  skipped: msg.skipped ?? 0,
                  fallback: msg.fallback ?? 0,
                  failed: msg.failed ?? 0,
                  errors: Array.isArray(msg.errors) ? msg.errors : [],
                })
                return
              }
              router.push('/dashboard/cellar')
              return
            } else if (msg.type === 'error') {
              throw new Error(msg.error)
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== line) throw parseErr
          }
        }
      }

      router.push('/dashboard/cellar')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm import')
      setConfirming(false)
      setProgress(null)
    }
  }

  const includedCount = rowsState.filter((row) => row.status !== 'SKIPPED').length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-lg font-semibold text-foreground">Review your wines</h2>
        <p className="text-sm text-muted-foreground">
          Edit any fields that need correcting. Amber fields had low extraction confidence — please
          verify them.{!isHistoricalImport && ' Wines already in your cellar are flagged to merge below — review before confirming.'}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{includedCount}</span> of {rowsState.length} wines will be imported
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => bulkSetStatus('PENDING')}
            disabled={confirming}
          >
            Select All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => bulkSetStatus('SKIPPED')}
            disabled={confirming}
          >
            Deselect All
          </Button>
        </div>
      </div>

      {missingRequiredRowIds.size > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Some rows are missing a producer or wine name — these fields will need to be filled in
            after import.
          </p>
        </div>
      )}

      {missingVintageRowIds.size > 3 && (
        <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {missingVintageRowIds.size} wines are missing a vintage year — vintage cannot be
            auto-filled. Please add it manually before or after import.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-secondary text-secondary-foreground">Include</TableHead>
              {isHistoricalImport && <TableHead>Consumed</TableHead>}
              <TableHead>Match</TableHead>
              {IMPORT_TARGET_FIELDS.map((field) => (
                <TableHead key={field.key} className="whitespace-nowrap">
                  {field.label}
                  {field.required ? ' *' : ''}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowsState.map((row) => (
              <TableRow
                key={row.id}
                className={cn(missingRequiredRowIds.has(row.id) && 'bg-amber-50 dark:bg-amber-950/20')}
              >
                <TableCell className="sticky left-0 bg-card">
                  <Select
                    value={row.status === 'SKIPPED' ? 'SKIPPED' : 'PENDING'}
                    onValueChange={(value) => handleStatusChange(row.id, value as ImportRowStatus)}
                  >
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Include</SelectItem>
                      <SelectItem value="SKIPPED">Skip</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                {isHistoricalImport && (
                  <TableCell>
                    <Checkbox
                      checked={row.markConsumed}
                      onCheckedChange={(checked) =>
                        setRowsState((prev) =>
                          prev.map((r) => (r.id === row.id ? { ...r, markConsumed: !!checked } : r))
                        )
                      }
                      aria-label="Mark as consumed"
                      className="border-secondary data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground"
                    />
                  </TableCell>
                )}
                <TableCell>
                  {row.mergeOutcome.type === 'merge' ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge className="whitespace-nowrap border-transparent bg-[#C9A84C]/20 text-[#8a6d1f] hover:bg-[#C9A84C]/20 dark:bg-[#C9A84C]/20 dark:text-[#e0c274]">
                          Merge with {row.mergeOutcome.label}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Quantity will be added to your existing bottle; blank fields will be filled
                        in — nothing overwritten.
                      </TooltipContent>
                    </Tooltip>
                  ) : row.mergeOutcome.type === 'needs-decision' ? (
                    <div className="flex flex-col gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="w-fit whitespace-nowrap border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                          >
                            Needs decision
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {row.mergeOutcome.label} exists in your cellar without a storage location.
                        </TooltipContent>
                      </Tooltip>
                      <Select
                        value={row.locationDecision}
                        onValueChange={(value) =>
                          setRowsState((prev) =>
                            prev.map((r) =>
                              r.id === row.id ? { ...r, locationDecision: value as LocationDecision } : r
                            )
                          )
                        }
                      >
                        <SelectTrigger className="h-7 w-[190px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="merge">
                            Merge, set location to {row.mergeOutcome.importedLocation}
                          </SelectItem>
                          <SelectItem value="separate">Keep as separate records</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">New</span>
                  )}
                </TableCell>
                {IMPORT_TARGET_FIELDS.map((field) => {
                  const value = row.mappedData[field.key]
                  const confidence = row.confidenceScores[field.key]
                  const lowConfidence = confidence !== undefined && confidence < LOW_CONFIDENCE_THRESHOLD
                  const enrichSource = row.enrichedSources[field.key]
                  const badgeLabel =
                    enrichSource === 'static' ? 'Matched'
                    : enrichSource === 'ai-suggested' ? 'AI suggested'
                    : enrichSource === 'vivino' ? 'Vivino score'
                    : enrichSource === 'ai-estimate' ? 'AI estimate — verify before trusting'
                    : null
                  const isStrongWarning = enrichSource === 'ai-estimate'
                  const isVerifiedSource = enrichSource === 'static' || enrichSource === 'vivino'
                  const badgeTooltip = isStrongWarning
                    ? 'No verified rating source found — this is Claude\'s best estimate. Verify before trusting.'
                    : 'Auto-filled from wine knowledge — verify before confirming'

                  const input = (
                    <Input
                      value={value === undefined || value === null ? '' : String(value)}
                      onChange={(e) => updateField(row.id, field.key, e.target.value)}
                      onBlur={() => handleBlur(row.id)}
                      className={cn(
                        'h-8 w-32 text-xs',
                        lowConfidence && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'
                      )}
                    />
                  )

                  const inputWithTooltip = lowConfidence ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{input}</TooltipTrigger>
                      <TooltipContent>Low confidence — please verify</TooltipContent>
                    </Tooltip>
                  ) : input

                  const isMissingVintage = field.key === 'vintage' && missingVintageRowIds.has(row.id)

                  return (
                    <TableCell key={field.key}>
                      {isMissingVintage ? (
                        <div className="flex items-center gap-1">
                          {inputWithTooltip}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>Vintage is missing and can&apos;t be auto-filled</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : badgeLabel ? (
                        <div className="flex flex-col gap-1">
                          {inputWithTooltip}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn(
                                'inline-flex w-fit cursor-default items-center rounded-sm px-1 py-0.5 text-[10px] font-medium leading-none',
                                isVerifiedSource
                                  ? 'bg-primary/10 text-primary'
                                  : isStrongWarning
                                    ? 'border border-amber-500 bg-amber-100 text-amber-800 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-200'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                              )}>
                                {badgeLabel}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{badgeTooltip}</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : inputWithTooltip}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-medium">
            Import finished — {result.imported} imported{result.merged > 0 ? ` (${result.merged} merged into existing wines)` : ''}, {result.skipped} skipped,{' '}
            {result.failed} could not be imported.
          </p>
          {result.fallback > 0 && (
            <p className="text-xs">
              {result.fallback} row{result.fallback === 1 ? '' : 's'} imported with a field cleared
              due to a value error — check the notes on those wines in your cellar.
            </p>
          )}
          <p className="text-xs">The rows below could not be imported. Add them manually:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {result.errors.map((e) => (
              <li key={e.rowId}>
                {[e.producer, e.wineName].filter(Boolean).join(' — ') || 'Row'}: {e.error}
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={() => router.push('/dashboard/cellar')}>
            Go to cellar
          </Button>
        </div>
      )}

      {!result && (
        <div className="flex items-center gap-3">
          <Button onClick={handleConfirm} disabled={confirming || includedCount === 0}>
            {confirming
              ? progress
                ? `Importing ${progress.imported} of ${progress.total}...`
                : 'Importing...'
              : `Confirm Import (${includedCount})`}
          </Button>
          {confirming && progress ? (
            <div className="flex items-center gap-2">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(progress.imported / progress.total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.round((progress.imported / progress.total) * 100)}%
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {rowsState.length - includedCount} row{rowsState.length - includedCount === 1 ? '' : 's'} skipped
            </p>
          )}
        </div>
      )}
    </div>
  )
}
