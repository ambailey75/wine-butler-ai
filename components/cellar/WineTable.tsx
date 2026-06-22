'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowUpDown, Columns3, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { SerializedWine } from '@/lib/wines/queries'
import { getEstimatedValue } from '@/lib/wines/queries'
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
import { Checkbox } from '@/components/ui/checkbox'
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

const STORAGE_KEY = 'wine-butler-column-visibility'

const TOGGLEABLE_COLUMNS: { id: string; label: string }[] = [
  { id: 'subRegion', label: 'Sub-Region' },
  { id: 'state', label: 'State/Province' },
  { id: 'format', label: 'Format' },
  { id: 'storageLocation', label: 'Storage Location' },
  { id: 'notes', label: 'Notes' },
]

const DEFAULT_VISIBILITY: VisibilityState = {
  subRegion: false,
  state: false,
  style: false,
  format: false,
  storageLocation: false,
  notes: false,
}

function loadVisibility(): VisibilityState {
  if (typeof window === 'undefined') return DEFAULT_VISIBILITY
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...DEFAULT_VISIBILITY, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return DEFAULT_VISIBILITY
}

function saveVisibility(vis: VisibilityState) {
  try {
    const toStore: Record<string, boolean> = {}
    for (const col of TOGGLEABLE_COLUMNS) {
      if (vis[col.id] !== undefined) toStore[col.id] = vis[col.id]
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  } catch { /* ignore */ }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

const multiSelectFilter: FilterFn<SerializedWine> = (row, columnId, filterValue: string[]) => {
  if (!filterValue?.length) return true
  const value = row.getValue<string | null>(columnId)
  return value !== null && filterValue.includes(value)
}

const vintageRangeFilter: FilterFn<SerializedWine> = (row, columnId, filterValue) => {
  const [min, max] = (filterValue ?? []) as [number | undefined, number | undefined]
  if (min === undefined && max === undefined) return true
  const value = row.getValue<number | null>(columnId)
  if (value === null || value === undefined) return false
  if (min !== undefined && value < min) return false
  if (max !== undefined && value > max) return false
  return true
}

const minRatingFilter: FilterFn<SerializedWine> = (row, _columnId, filterValue) => {
  const minRating = filterValue as number | undefined
  if (minRating === undefined) return true
  const value = row.getValue<number | null>('rating')
  if (value === null || value === undefined) return false
  return value >= minRating
}

const globalSearchFilter: FilterFn<SerializedWine> = (row, _columnId, filterValue) => {
  const search = String(filterValue).toLowerCase().trim()
  if (!search) return true
  const wine = row.original
  return [wine.producer, wine.wineName, wine.region, wine.country, wine.vineyard, wine.varietal, wine.vendor, wine.notes, wine.storageLocation]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(search))
}

function SortButton({
  column,
  label,
}: {
  column: Column<SerializedWine, unknown>
  label: string
}) {
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

function WineRowActions({
  wine,
  onDelete,
}: {
  wine: SerializedWine
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/cellar/${wine.id}`}>
            <Eye className="mr-2 h-4 w-4" />
            View
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/cellar/${wine.id}/edit`}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ColumnToggle({
  visibility,
  onToggle,
}: {
  visibility: VisibilityState
  onToggle: (id: string, checked: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Columns3 className="h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {TOGGLEABLE_COLUMNS.map((col) => (
          <label
            key={col.id}
            className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Checkbox
              checked={visibility[col.id] !== false}
              onCheckedChange={(checked) => onToggle(col.id, checked === true)}
            />
            {col.label}
          </label>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type CellarView = 'in-cellar' | 'all' | 'consumed'

export function WineTable({ wines }: { wines: SerializedWine[] }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_VISIBILITY)
  const [globalFilter, setGlobalFilter] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SerializedWine | null>(null)
  const [cellarView, setCellarView] = useState<CellarView>('in-cellar')

  useEffect(() => {
    setColumnVisibility(loadVisibility())
  }, [])

  const handleVisibilityChange = (updater: Updater<VisibilityState>) => {
    setColumnVisibility((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      saveVisibility(next)
      return next
    })
  }

  const handleColumnToggle = (id: string, checked: boolean) => {
    const updated = { ...columnVisibility, [id]: checked }
    setColumnVisibility(updated)
    saveVisibility(updated)
  }

  const filteredWines = useMemo(() => {
    if (cellarView === 'all') return wines
    if (cellarView === 'consumed') return wines.filter((w) => w.isFullyConsumed)
    return wines.filter((w) => !w.isFullyConsumed)
  }, [wines, cellarView])

  const columns = useMemo<ColumnDef<SerializedWine>[]>(
    () => [
      {
        accessorKey: 'producer',
        header: ({ column }) => <SortButton column={column} label="Producer" />,
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.producer}</span>
        ),
      },
      {
        accessorKey: 'wineName',
        header: ({ column }) => <SortButton column={column} label="Wine Name" />,
      },
      {
        accessorKey: 'vintage',
        header: ({ column }) => <SortButton column={column} label="Vintage" />,
        cell: ({ row }) => row.original.vintage ?? '—',
        filterFn: vintageRangeFilter,
      },
      {
        accessorKey: 'country',
        header: ({ column }) => <SortButton column={column} label="Country" />,
        cell: ({ row }) => row.original.country ?? '—',
      },
      {
        accessorKey: 'region',
        header: ({ column }) => <SortButton column={column} label="Region" />,
        cell: ({ row }) => row.original.region ?? '—',
      },
      {
        accessorKey: 'subRegion',
        header: ({ column }) => <SortButton column={column} label="Sub-Region" />,
        cell: ({ row }) => row.original.subRegion ?? '—',
      },
      {
        accessorKey: 'state',
        header: ({ column }) => <SortButton column={column} label="State" />,
        cell: ({ row }) => row.original.state ?? '—',
      },
      {
        accessorKey: 'varietal',
        header: ({ column }) => <SortButton column={column} label="Varietal" />,
        cell: ({ row }) => row.original.varietal ?? '—',
      },
      {
        accessorKey: 'style',
        header: ({ column }) => <SortButton column={column} label="Style" />,
        cell: ({ row }) => row.original.style ?? '—',
        filterFn: multiSelectFilter,
        enableHiding: false,
      },
      {
        accessorKey: 'format',
        header: ({ column }) => <SortButton column={column} label="Format" />,
        cell: ({ row }) => row.original.format ?? '—',
        filterFn: multiSelectFilter,
      },
      {
        accessorKey: 'quantity',
        header: ({ column }) => <SortButton column={column} label="Qty" />,
      },
      {
        accessorKey: 'purchasePrice',
        header: ({ column }) => <SortButton column={column} label="Purchase Price" />,
        cell: ({ row }) =>
          row.original.purchasePrice !== null
            ? formatCurrency(row.original.purchasePrice)
            : '—',
      },
      {
        accessorKey: 'currentEstValue',
        header: ({ column }) => <SortButton column={column} label="Est. Value/Bottle" />,
        accessorFn: (row) => {
          const est = getEstimatedValue(row.currentEstValue, row.purchasePrice)
          return est.perBottle
        },
        cell: ({ row }) => {
          const w = row.original
          const est = getEstimatedValue(w.currentEstValue, w.purchasePrice)
          if (est.perBottle === null) return <span className="text-muted-foreground">No data</span>
          if (est.isApproximate) return <span title="Based on purchase price">≈{formatCurrency(est.perBottle)}</span>
          return formatCurrency(est.perBottle)
        },
      },
      {
        id: 'totalCost',
        accessorFn: (row) =>
          row.totalCostOverride ?? (row.purchasePrice !== null ? row.purchasePrice * row.quantity : null),
        header: ({ column }) => <SortButton column={column} label="Total Cost" />,
        cell: ({ row }) => {
          const w = row.original
          const val = w.totalCostOverride ?? (w.purchasePrice !== null ? w.purchasePrice * w.quantity : null)
          return val !== null ? formatCurrency(val) : '—'
        },
      },
      {
        id: 'totalEstValue',
        accessorFn: (row) => {
          if (row.totalValueOverride !== null) return row.totalValueOverride
          const est = getEstimatedValue(row.currentEstValue, row.purchasePrice)
          return est.perBottle !== null ? est.perBottle * row.quantity : null
        },
        header: ({ column }) => <SortButton column={column} label="Total Est. Value" />,
        cell: ({ row }) => {
          const w = row.original
          if (w.totalValueOverride !== null) return formatCurrency(w.totalValueOverride)
          const est = getEstimatedValue(w.currentEstValue, w.purchasePrice)
          if (est.perBottle === null) return <span className="text-muted-foreground">No data</span>
          const total = est.perBottle * w.quantity
          if (est.isApproximate) return <span title="Based on purchase price">≈{formatCurrency(total)}</span>
          return formatCurrency(total)
        },
      },
      {
        accessorKey: 'rating',
        header: ({ column }) => <SortButton column={column} label="Rating" />,
        cell: ({ row }) => row.original.rating !== null ? row.original.rating : '—',
        filterFn: minRatingFilter,
      },
      {
        accessorKey: 'storageLocation',
        header: ({ column }) => <SortButton column={column} label="Storage Location" />,
        cell: ({ row }) => row.original.storageLocation ?? '—',
      },
      {
        accessorKey: 'notes',
        header: 'Notes',
        cell: ({ row }) => {
          const notes = row.original.notes
          if (!notes) return '—'
          return notes.length > 50 ? `${notes.slice(0, 50)}...` : notes
        },
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const w = row.original
          if (w.isFullyConsumed) return <span className="text-muted-foreground">Consumed</span>
          if (w.consumedQuantity > 0) return <span className="text-amber-600">{w.quantity - w.consumedQuantity} of {w.quantity}</span>
          return null
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <WineRowActions wine={row.original} onDelete={() => setDeleteTarget(row.original)} />
        ),
      },
    ],
    []
  )

  const filterOptions = useMemo(() => {
    const styles = new Set<string>()
    const formats = new Set<string>()

    for (const wine of filteredWines) {
      if (wine.style) styles.add(wine.style)
      if (wine.format) formats.add(wine.format)
    }

    return {
      styles: Array.from(styles).sort(),
      formats: Array.from(formats).sort(),
    }
  }, [filteredWines])

  const table = useReactTable({
    data: filteredWines,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: handleVisibilityChange,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: globalSearchFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
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
            {(['in-cellar', 'all', 'consumed'] as CellarView[]).map((view) => (
              <button
                key={view}
                onClick={() => setCellarView(view)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                  cellarView === view
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {view === 'in-cellar' ? 'In Cellar' : view === 'all' ? 'All' : 'Consumed'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <WineFilters table={table} options={filterOptions} />
          <ColumnToggle visibility={columnVisibility} onToggle={handleColumnToggle} />
        </div>
      </div>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
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
                    <TableCell key={cell.id}>
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
        wineLabel={
          deleteTarget ? `${deleteTarget.producer} ${deleteTarget.wineName}` : ''
        }
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
    </div>
  )
}
