'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  type ColumnDef,
  type ColumnFiltersState,
  type VisibilityState,
  type FilterFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, Check, Eye, GlassWater, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { SerializedWine } from '@/lib/wines/queries'
import { getEstimatedValue } from '@/lib/wines/queries'
import { normalizeRegionSpelling } from '@/lib/wines/normalize'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Pagination } from '@/components/ui/pagination'
import { WineFilters } from './WineFilters'
import { DeleteWineDialog } from './DeleteWineDialog'
import { MarkConsumedDialog } from './MarkConsumedDialog'

const STYLE_OPTIONS = ['Red', 'White', 'Rosé', 'Sparkling', 'Dessert', 'Fortified']

const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  subRegion: false,
  countryState: false,
  appellation: false,
  vineyard: false,
  totalCost: false,
  format: false,
  storageLocation: false,
  notes: false,
  tastingNotes: false,
  pairingNotes: false,
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

const multiSelectFilter: FilterFn<SerializedWine> = (row, columnId, filterValue: string[]) => {
  if (!filterValue?.length) return true
  const value = row.getValue<string | null>(columnId)
  return value !== null && filterValue.includes(value)
}

const countryStateFilter: FilterFn<SerializedWine> = (row, _columnId, filterValue: string[]) => {
  if (!filterValue?.length) return true
  const { country, state } = row.original
  return filterValue.some((v) => v === country || v === state)
}

const exactYearFilter: FilterFn<SerializedWine> = (row, _columnId, filterValue) => {
  if (filterValue === undefined || filterValue === null) return true
  const value = row.getValue<number | null>('vintage')
  return value === filterValue
}

const minRatingFilter: FilterFn<SerializedWine> = (row, _columnId, filterValue) => {
  if (filterValue === undefined) return true
  const value = row.getValue<number | null>('rating')
  if (value === null || value === undefined) return false
  return value >= (filterValue as number)
}

const globalSearchFilter: FilterFn<SerializedWine> = (row, _columnId, filterValue) => {
  const search = String(filterValue).toLowerCase().trim()
  if (!search) return true
  const w = row.original
  return [w.producer, w.wineName, w.region, w.country, w.vineyard, w.varietal, w.vendor, w.notes, w.storageLocation, w.state, w.subRegion]
    .filter((v): v is string => typeof v === 'string')
    .some((v) => v.toLowerCase().includes(search))
}

// ─── Inline Editing Primitives ──────────────────────────────────────────────

interface EditCellState {
  wineId: string
  field: string
}

function useInlineEdit(wines: SerializedWine[], setWines: React.Dispatch<React.SetStateAction<SerializedWine[]>>) {
  const [editing, setEditing] = useState<EditCellState | null>(null)
  const [savedCell, setSavedCell] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>()

  const startEdit = useCallback((wineId: string, field: string) => {
    setEditing({ wineId, field })
  }, [])

  const cancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  const saveField = useCallback(async (wineId: string, updates: Record<string, unknown>) => {
    setWines((prev) =>
      prev.map((w) => (w.id === wineId ? { ...w, ...updates } : w))
    )
    setEditing(null)

    try {
      const res = await fetch(`/api/wines/${wineId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error()

      const cellKey = `${wineId}-${Object.keys(updates)[0]}`
      setSavedCell(cellKey)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSavedCell(null), 1200)
    } catch {
      // Revert is complex — for now the optimistic update stays.
      // The next page load will show the server state.
    }
  }, [setWines])

  return { editing, savedCell, startEdit, cancelEdit, saveField }
}

// ─── Cell Components ────────────────────────────────────────────────────────

function TextEditCell({
  value,
  wineId,
  field,
  editing,
  savedCell,
  onStart,
  onSave,
  onCancel,
  placeholder,
  className,
}: {
  value: string | null
  wineId: string
  field: string
  editing: EditCellState | null
  savedCell: string | null
  onStart: (id: string, f: string) => void
  onSave: (id: string, updates: Record<string, unknown>) => void
  onCancel: () => void
  placeholder?: string
  className?: string
}) {
  const isEditing = editing?.wineId === wineId && editing?.field === field
  const isSaved = savedCell === `${wineId}-${field}`
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        defaultValue={value ?? ''}
        className="h-7 min-w-[80px] text-xs"
        onBlur={(e) => {
          const v = e.target.value.trim()
          onSave(wineId, { [field]: v || null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value.trim()
            onSave(wineId, { [field]: v || null })
          }
          if (e.key === 'Escape') onCancel()
        }}
      />
    )
  }

  return (
    <div
      onClick={() => onStart(wineId, field)}
      className={`group relative cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-amber-50/40 hover:ring-1 hover:ring-[rgba(201,168,76,0.45)] ${className ?? ''}`}
    >
      {isSaved && <Check className="mr-1 inline h-3 w-3 text-emerald-500" />}
      {value || <span className="text-muted-foreground">{placeholder ?? '—'}</span>}
      <Pencil className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-amber-500/50 opacity-0 group-hover:opacity-100" />
    </div>
  )
}

function NumberEditCell({
  value,
  wineId,
  field,
  editing,
  savedCell,
  onStart,
  onSave,
  onCancel,
  format,
}: {
  value: number | null
  wineId: string
  field: string
  editing: EditCellState | null
  savedCell: string | null
  onStart: (id: string, f: string) => void
  onSave: (id: string, updates: Record<string, unknown>) => void
  onCancel: () => void
  format?: (v: number) => string
}) {
  const isEditing = editing?.wineId === wineId && editing?.field === field
  const isSaved = savedCell === `${wineId}-${field}`
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        defaultValue={value ?? ''}
        className="h-7 w-20 text-xs"
        onBlur={(e) => {
          const v = e.target.value.trim()
          onSave(wineId, { [field]: v ? Number(v) : null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = (e.target as HTMLInputElement).value.trim()
            onSave(wineId, { [field]: v ? Number(v) : null })
          }
          if (e.key === 'Escape') onCancel()
        }}
      />
    )
  }

  return (
    <div
      onClick={() => onStart(wineId, field)}
      className="group relative cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-amber-50/40 hover:ring-1 hover:ring-[rgba(201,168,76,0.45)]"
    >
      {isSaved && <Check className="mr-1 inline h-3 w-3 text-emerald-500" />}
      {value !== null ? (format ? format(value) : value) : <span className="text-muted-foreground">—</span>}
      <Pencil className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-amber-500/50 opacity-0 group-hover:opacity-100" />
    </div>
  )
}

function StyleSelectCell({
  value,
  wineId,
  editing,
  savedCell,
  onStart,
  onSave,
  onCancel,
}: {
  value: string | null
  wineId: string
  editing: EditCellState | null
  savedCell: string | null
  onStart: (id: string, f: string) => void
  onSave: (id: string, updates: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const isEditing = editing?.wineId === wineId && editing?.field === 'style'
  const isSaved = savedCell === `${wineId}-style`
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (isEditing) selectRef.current?.focus()
  }, [isEditing])

  if (isEditing) {
    return (
      <select
        ref={selectRef}
        defaultValue={value ?? ''}
        className="h-7 rounded border border-border bg-background px-1 text-xs"
        onBlur={(e) => {
          onSave(wineId, { style: e.target.value || null })
        }}
        onChange={(e) => {
          onSave(wineId, { style: e.target.value || null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      >
        <option value="">—</option>
        {STYLE_OPTIONS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    )
  }

  return (
    <div
      onClick={() => onStart(wineId, 'style')}
      className="group relative cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-amber-50/40 hover:ring-1 hover:ring-[rgba(201,168,76,0.45)]"
    >
      {isSaved && <Check className="mr-1 inline h-3 w-3 text-emerald-500" />}
      {value || <span className="text-muted-foreground">—</span>}
      <Pencil className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-amber-500/50 opacity-0 group-hover:opacity-100" />
    </div>
  )
}

function DualFieldCell({
  topValue,
  bottomValue,
  wineId,
  topField,
  bottomField,
  topLabel,
  bottomLabel,
  editing,
  savedCell,
  onStart,
  onSave,
  onCancel,
}: {
  topValue: string | null
  bottomValue: string | null
  wineId: string
  topField: string
  bottomField: string
  topLabel: string
  bottomLabel: string
  editing: EditCellState | null
  savedCell: string | null
  onStart: (id: string, f: string) => void
  onSave: (id: string, updates: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const dualField = `${topField}_${bottomField}`
  const isEditing = editing?.wineId === wineId && editing?.field === dualField
  const isSaved = savedCell === `${wineId}-${topField}` || savedCell === `${wineId}-${bottomField}`
  const topRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) topRef.current?.focus()
  }, [isEditing])

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1">
        <Input
          ref={topRef}
          defaultValue={topValue ?? ''}
          placeholder={topLabel}
          className="h-6 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        <Input
          defaultValue={bottomValue ?? ''}
          placeholder={bottomLabel}
          className="h-6 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter') {
              const topVal = topRef.current?.value.trim() || null
              const botVal = (e.target as HTMLInputElement).value.trim() || null
              onSave(wineId, { [topField]: topVal, [bottomField]: botVal })
            }
          }}
          onBlur={(e) => {
            const topVal = topRef.current?.value.trim() || null
            const botVal = e.target.value.trim() || null
            onSave(wineId, { [topField]: topVal, [bottomField]: botVal })
          }}
        />
      </div>
    )
  }

  return (
    <div
      onClick={() => onStart(wineId, dualField)}
      className="group relative cursor-pointer rounded px-1 py-0.5 hover:bg-amber-50/40 hover:ring-1 hover:ring-[rgba(201,168,76,0.45)]"
    >
      {isSaved && <Check className="mr-1 inline h-3 w-3 text-emerald-500" />}
      <div className="text-xs leading-tight">
        {topValue || <span className="text-muted-foreground">—</span>}
      </div>
      {bottomValue && (
        <div className="text-[10px] leading-tight text-muted-foreground">{bottomValue}</div>
      )}
      <Pencil className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-amber-500/50 opacity-0 group-hover:opacity-100" />
    </div>
  )
}

function NotesEditCell({
  value,
  wineId,
  field,
  editing,
  savedCell,
  onStart,
  onSave,
  onCancel,
}: {
  value: string | null
  wineId: string
  field: string
  editing: EditCellState | null
  savedCell: string | null
  onStart: (id: string, f: string) => void
  onSave: (id: string, updates: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const isEditing = editing?.wineId === wineId && editing?.field === field
  const isSaved = savedCell === `${wineId}-${field}`
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus()
  }, [isEditing])

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        defaultValue={value ?? ''}
        className="min-h-[60px] w-full rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        onBlur={(e) => {
          onSave(wineId, { [field]: e.target.value.trim() || null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
    )
  }

  const truncated = value && value.length > 40 ? `${value.slice(0, 40)}...` : value

  return (
    <div
      onClick={() => onStart(wineId, field)}
      title={value ?? undefined}
      className="group relative max-w-[120px] cursor-pointer truncate rounded px-1 py-0.5 text-xs hover:bg-amber-50/40 hover:ring-1 hover:ring-[rgba(201,168,76,0.45)]"
    >
      {isSaved && <Check className="mr-1 inline h-3 w-3 text-emerald-500" />}
      {truncated || <span className="text-muted-foreground">—</span>}
      <Pencil className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-amber-500/50 opacity-0 group-hover:opacity-100" />
    </div>
  )
}

// ─── Mobile Card ─────────────────────────────────────────────────────────────

function WineMobileCard({
  wine,
  onDelete,
  onConsume,
}: {
  wine: SerializedWine
  onDelete: () => void
  onConsume: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const est = getEstimatedValue(wine.currentEstValue, wine.purchasePrice)

  const drinkWindow =
    wine.drinkWindowStart && wine.drinkWindowEnd
      ? `${wine.drinkWindowStart} – ${wine.drinkWindowEnd}`
      : wine.drinkWindowStart
      ? `${wine.drinkWindowStart}+`
      : wine.drinkWindowEnd
      ? `Until ${wine.drinkWindowEnd}`
      : null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-foreground">
            {wine.producer} {wine.wineName}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[wine.vintage?.toString(), wine.varietal, wine.region].filter(Boolean).join(' · ')}
          </p>
        </div>
        <WineRowActions wine={wine} onDelete={onDelete} onConsume={onConsume} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {wine.style && (
          <span className="inline-flex items-center rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-medium text-secondary">
            {wine.style}
          </span>
        )}
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {wine.quantity} {wine.quantity === 1 ? 'bottle' : 'bottles'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Price</p>
          <p className="font-medium">{wine.purchasePrice ? formatCurrency(wine.purchasePrice) : '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Est. Value</p>
          <p className="font-medium">
            {est.perBottle !== null
              ? est.isApproximate
                ? `≈${formatCurrency(est.perBottle)}`
                : formatCurrency(est.perBottle)
              : '—'}
          </p>
        </div>
        {wine.rating !== null && (
          <div>
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="font-medium">{wine.rating}</p>
          </div>
        )}
        {drinkWindow && (
          <div>
            <p className="text-xs text-muted-foreground">Drink Window</p>
            <p className="font-medium">{drinkWindow}</p>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-sm">
          {wine.country && (
            <div>
              <p className="text-xs text-muted-foreground">Country</p>
              <p>{wine.country}{wine.state ? ` / ${wine.state}` : ''}</p>
            </div>
          )}
          {wine.vineyard && (
            <div>
              <p className="text-xs text-muted-foreground">Vineyard</p>
              <p>{wine.vineyard}</p>
            </div>
          )}
          {wine.format && (
            <div>
              <p className="text-xs text-muted-foreground">Format</p>
              <p>{wine.format}</p>
            </div>
          )}
          {wine.storageLocation && (
            <div>
              <p className="text-xs text-muted-foreground">Location</p>
              <p>{wine.storageLocation}</p>
            </div>
          )}
          {wine.notes && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p>{wine.notes}</p>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  )
}

// ─── Row Actions ────────────────────────────────────────────────────────────

function WineRowActions({
  wine,
  onDelete,
  onConsume,
}: {
  wine: SerializedWine
  onDelete: () => void
  onConsume: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/cellar/${wine.id}`}>
            <Eye className="mr-2 h-4 w-4" />
            View Details
          </Link>
        </DropdownMenuItem>
        {!wine.isFullyConsumed && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onConsume}>
              <GlassWater className="mr-2 h-4 w-4" />
              Mark as Consumed
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Main Table ─────────────────────────────────────────────────────────────

type CellarView = 'in-cellar' | 'all' | 'consumed'

export function WineTable({ wines: initialWines }: { wines: SerializedWine[] }) {
  const [wines, setWines] = useState(initialWines)
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_COLUMN_VISIBILITY)
  const [globalFilter, setGlobalFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SerializedWine | null>(null)
  const [consumeTarget, setConsumeTarget] = useState<SerializedWine | null>(null)
  const [cellarView, setCellarView] = useState<CellarView>('in-cellar')
  const [showEditTooltip, setShowEditTooltip] = useState(false)

  useEffect(() => { setWines(initialWines) }, [initialWines])
  useEffect(() => {
    if (!localStorage.getItem('wine-butler-edit-tooltip-seen')) setShowEditTooltip(true)
  }, [])

  const { editing, savedCell, startEdit, cancelEdit, saveField } = useInlineEdit(wines, setWines)

  const startEditWithDismiss = useCallback((wineId: string, field: string) => {
    if (showEditTooltip) {
      localStorage.setItem('wine-butler-edit-tooltip-seen', '1')
      setShowEditTooltip(false)
    }
    startEdit(wineId, field)
  }, [showEditTooltip, startEdit])

  const tabCounts = useMemo(() => ({
    inCellar: wines.filter((w) => !w.isFullyConsumed).length,
    all: wines.length,
    consumed: wines.filter((w) => w.isFullyConsumed).length,
  }), [wines])

  const filteredWines = useMemo(() => {
    if (cellarView === 'all') return wines
    if (cellarView === 'consumed') return wines.filter((w) => w.isFullyConsumed)
    return wines.filter((w) => !w.isFullyConsumed)
  }, [wines, cellarView])

  const columns = useMemo<ColumnDef<SerializedWine>[]>(
    () => [
      {
        accessorKey: 'producer',
        header: ({ column }) => <SortHeader column={column} label="Producer" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.producer}
            wineId={row.original.id} field="producer"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
            className="font-medium"
          />
        ),
        filterFn: multiSelectFilter,
      },
      {
        accessorKey: 'wineName',
        header: ({ column }) => <SortHeader column={column} label="Wine" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.wineName}
            wineId={row.original.id} field="wineName"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'vintage',
        header: ({ column }) => <SortHeader column={column} label="Yr" />,
        cell: ({ row }) => (
          <NumberEditCell
            value={row.original.vintage}
            wineId={row.original.id} field="vintage"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
        filterFn: exactYearFilter,
      },
      {
        id: 'countryState',
        accessorFn: (row) => row.country,
        header: ({ column }) => <SortHeader column={column} label="Country / State" />,
        cell: ({ row }) => (
          <DualFieldCell
            topValue={row.original.country}
            bottomValue={row.original.state}
            wineId={row.original.id}
            topField="country" bottomField="state"
            topLabel="Country" bottomLabel="State"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
        filterFn: countryStateFilter,
      },
      {
        id: 'regionSubRegion',
        accessorFn: (row) => row.region,
        header: ({ column }) => <SortHeader column={column} label="Region" />,
        cell: ({ row }) => (
          <DualFieldCell
            topValue={row.original.region}
            bottomValue={row.original.subRegion}
            wineId={row.original.id}
            topField="region" bottomField="subRegion"
            topLabel="Region" bottomLabel="Sub-Region"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
        filterFn: multiSelectFilter,
      },
      {
        id: 'subRegion',
        accessorKey: 'subRegion',
        filterFn: multiSelectFilter,
        enableSorting: false,
        header: () => null,
        cell: () => null,
      },
      {
        accessorKey: 'appellation',
        header: ({ column }) => <SortHeader column={column} label="Appellation" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.appellation}
            wineId={row.original.id} field="appellation"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'varietal',
        header: ({ column }) => <SortHeader column={column} label="Varietal" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.varietal}
            wineId={row.original.id} field="varietal"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
        filterFn: multiSelectFilter,
      },
      {
        accessorKey: 'vineyard',
        header: ({ column }) => <SortHeader column={column} label="Vineyard" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.vineyard}
            wineId={row.original.id} field="vineyard"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'quantity',
        header: ({ column }) => <SortHeader column={column} label="Qty" />,
        cell: ({ row }) => (
          <NumberEditCell
            value={row.original.quantity}
            wineId={row.original.id} field="quantity"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'style',
        header: ({ column }) => <SortHeader column={column} label="Style" />,
        cell: ({ row }) => (
          <StyleSelectCell
            value={row.original.style}
            wineId={row.original.id}
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'purchasePrice',
        header: ({ column }) => <SortHeader column={column} label="Price" />,
        cell: ({ row }) => (
          <NumberEditCell
            value={row.original.purchasePrice}
            wineId={row.original.id} field="purchasePrice"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
            format={formatCurrency}
          />
        ),
      },
      {
        accessorKey: 'rating',
        header: ({ column }) => <SortHeader column={column} label="Score" />,
        cell: ({ row }) => (
          <NumberEditCell
            value={row.original.rating}
            wineId={row.original.id} field="rating"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
        filterFn: minRatingFilter,
      },
      {
        id: 'estValue',
        accessorFn: (row) => {
          const est = getEstimatedValue(row.currentEstValue, row.purchasePrice)
          return est.perBottle
        },
        header: ({ column }) => <SortHeader column={column} label="Est. Val" />,
        cell: ({ row }) => {
          const w = row.original
          const est = getEstimatedValue(w.currentEstValue, w.purchasePrice)
          const isEditing = editing?.wineId === w.id && editing?.field === 'currentEstValue'
          const isSaved = savedCell === `${w.id}-currentEstValue`

          if (isEditing) {
            return (
              <NumberEditCell
                value={w.currentEstValue}
                wineId={w.id} field="currentEstValue"
                editing={editing} savedCell={savedCell}
                onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
                format={formatCurrency}
              />
            )
          }

          return (
            <div
              onClick={() => startEditWithDismiss(w.id, 'currentEstValue')}
              className="cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-accent"
            >
              {isSaved && <Check className="mr-1 inline h-3 w-3 text-emerald-500" />}
              {est.perBottle !== null ? (
                est.isApproximate ? (
                  <span className="text-muted-foreground" title="Based on purchase price">≈{formatCurrency(est.perBottle)}</span>
                ) : (
                  formatCurrency(est.perBottle)
                )
              ) : (
                <span className="text-muted-foreground">No data</span>
              )}
            </div>
          )
        },
      },
      {
        id: 'totalCost',
        accessorFn: (row) =>
          row.totalCostOverride ?? (row.purchasePrice !== null ? row.purchasePrice * row.quantity : null),
        header: ({ column }) => <SortHeader column={column} label="Total Cost" />,
        cell: ({ row }) => {
          const w = row.original
          const val = w.totalCostOverride ?? (w.purchasePrice !== null ? w.purchasePrice * w.quantity : null)
          return (
            <div className="bg-muted/30 px-1 py-0.5 text-xs">
              {val !== null ? formatCurrency(val) : <span className="text-muted-foreground">—</span>}
            </div>
          )
        },
      },
      {
        id: 'totalEstValue',
        accessorFn: (row) => {
          if (row.totalValueOverride !== null) return row.totalValueOverride
          const est = getEstimatedValue(row.currentEstValue, row.purchasePrice)
          return est.perBottle !== null ? est.perBottle * row.quantity : null
        },
        header: ({ column }) => <SortHeader column={column} label="Total Val" />,
        cell: ({ row }) => {
          const w = row.original
          if (w.totalValueOverride !== null) {
            return <div className="bg-muted/30 px-1 py-0.5 text-xs">{formatCurrency(w.totalValueOverride)}</div>
          }
          const est = getEstimatedValue(w.currentEstValue, w.purchasePrice)
          if (est.perBottle === null) {
            return <div className="bg-muted/30 px-1 py-0.5 text-xs text-muted-foreground">No data</div>
          }
          const total = est.perBottle * w.quantity
          return (
            <div className="bg-muted/30 px-1 py-0.5 text-xs">
              {est.isApproximate ? <span className="text-muted-foreground">≈{formatCurrency(total)}</span> : formatCurrency(total)}
            </div>
          )
        },
      },
      {
        accessorKey: 'drinkWindowStart',
        header: ({ column }) => <SortHeader column={column} label="Drink Start" />,
        cell: ({ row }) => (
          <NumberEditCell
            value={row.original.drinkWindowStart}
            wineId={row.original.id} field="drinkWindowStart"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'drinkWindowEnd',
        header: ({ column }) => <SortHeader column={column} label="Drink Until" />,
        cell: ({ row }) => (
          <NumberEditCell
            value={row.original.drinkWindowEnd}
            wineId={row.original.id} field="drinkWindowEnd"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'format',
        header: ({ column }) => <SortHeader column={column} label="Format" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.format}
            wineId={row.original.id} field="format"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'storageLocation',
        header: ({ column }) => <SortHeader column={column} label="Location" />,
        cell: ({ row }) => (
          <TextEditCell
            value={row.original.storageLocation}
            wineId={row.original.id} field="storageLocation"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'notes',
        header: 'Notes',
        cell: ({ row }) => (
          <NotesEditCell
            value={row.original.notes}
            wineId={row.original.id} field="notes"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'tastingNotes',
        header: 'Tasting',
        cell: ({ row }) => (
          <NotesEditCell
            value={row.original.tastingNotes}
            wineId={row.original.id} field="tastingNotes"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        accessorKey: 'pairingNotes',
        header: 'Pairing',
        cell: ({ row }) => (
          <NotesEditCell
            value={row.original.pairingNotes}
            wineId={row.original.id} field="pairingNotes"
            editing={editing} savedCell={savedCell}
            onStart={startEditWithDismiss} onSave={saveField} onCancel={cancelEdit}
          />
        ),
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <WineRowActions
            wine={row.original}
            onDelete={() => setDeleteTarget(row.original)}
            onConsume={() => setConsumeTarget(row.original)}
          />
        ),
      },
    ],
    [editing, savedCell, startEditWithDismiss, saveField, cancelEdit]
  )

  const filterOptions = useMemo(() => {
    const countryStates = new Set<string>()
    const producers = new Set<string>()
    const regions = new Set<string>()
    const subRegions = new Set<string>()
    const varietals = new Set<string>()
    const vintages = new Set<number>()

    for (const wine of filteredWines) {
      if (wine.country) countryStates.add(wine.country)
      if (wine.state) countryStates.add(wine.state)
      if (wine.producer) producers.add(wine.producer)
      // Safety net: data written before normalization shipped, or edited
      // directly via the inline TextEditCell (which bypasses the import
      // pipeline), may still hold unnormalized spelling/casing.
      if (wine.region) regions.add(normalizeRegionSpelling(wine.region))
      if (wine.subRegion) subRegions.add(normalizeRegionSpelling(wine.subRegion))
      if (wine.varietal) varietals.add(wine.varietal)
      if (wine.vintage) vintages.add(wine.vintage)
    }

    return {
      countries: Array.from(countryStates).sort(),
      producers: Array.from(producers).sort(),
      regions: Array.from(regions).sort(),
      subRegions: Array.from(subRegions).sort(),
      varietals: Array.from(varietals).sort(),
      vintages: Array.from(vintages).sort((a, b) => b - a),
    }
  }, [filteredWines])

  const table = useReactTable({
    data: filteredWines,
    columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: globalSearchFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 40 } },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search your cellar..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="sm:max-w-xs"
          />
          <div className="flex rounded-md border border-border">
            {(['in-cellar', 'all', 'consumed'] as CellarView[]).map((view) => {
              const label =
                view === 'in-cellar' ? `In Cellar (${tabCounts.inCellar})`
                : view === 'all' ? `All (${tabCounts.all})`
                : `Consumed (${tabCounts.consumed})`
              return (
                <button
                  key={view}
                  onClick={() => setCellarView(view)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                    cellarView === view
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
        <WineFilters
          table={table}
          options={filterOptions}
          globalFilter={globalFilter}
          onClearSearch={() => setGlobalFilter('')}
          onResetColumns={() => setColumnVisibility(DEFAULT_COLUMN_VISIBILITY)}
        />
      </div>

      {/* Mobile: card list */}
      <div className="md:hidden space-y-3">
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => (
            <WineMobileCard
              key={row.id}
              wine={row.original}
              onDelete={() => setDeleteTarget(row.original)}
              onConsume={() => setConsumeTarget(row.original)}
            />
          ))
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No wines match your search or filters.
          </p>
        )}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="whitespace-nowrap px-2">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-2 py-1">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No wines match your search or filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        pageIndex={table.getState().pagination.pageIndex}
        pageCount={table.getPageCount()}
        onPageChange={(pageIndex) => table.setPageIndex(pageIndex)}
      />

      <DeleteWineDialog
        wineId={deleteTarget?.id ?? ''}
        wineLabel={deleteTarget ? `${deleteTarget.producer} ${deleteTarget.wineName}` : ''}
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      />

      <MarkConsumedDialog
        wine={consumeTarget}
        open={consumeTarget !== null}
        onOpenChange={(open) => { if (!open) setConsumeTarget(null) }}
        onConsumed={(wineId, update) => {
          setWines((prev) => prev.map((w) => (w.id === wineId ? { ...w, ...update } : w)))
          setConsumeTarget(null)
        }}
      />

      {showEditTooltip && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background shadow-lg">
          <Pencil className="h-3.5 w-3.5 shrink-0" />
          Click any cell to edit
          <button
            onClick={() => {
              localStorage.setItem('wine-butler-edit-tooltip-seen', '1')
              setShowEditTooltip(false)
            }}
            className="ml-2 text-background/50 hover:text-background"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// Extracted to avoid type issues with Column generic
function SortHeader({ column, label }: { column: { getIsSorted: () => false | 'asc' | 'desc'; toggleSorting: (desc: boolean) => void }; label: string }) {
  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 gap-1 px-2"
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {label}
      <ArrowUpDown className="h-3.5 w-3.5" />
    </Button>
  )
}
