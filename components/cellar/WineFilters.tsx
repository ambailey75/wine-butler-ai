'use client'

import { Check, ChevronsUpDown, Columns2, Filter, X } from 'lucide-react'
import type { Table } from '@tanstack/react-table'
import type { SerializedWine } from '@/lib/wines/queries'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

// ─── Column picker config ────────────────────────────────────────────────────

export const COLUMN_GROUPS: { label: string; columns: { id: string; label: string }[] }[] = [
  {
    label: 'Identity',
    columns: [
      { id: 'producer', label: 'Producer' },
      { id: 'wineName', label: 'Wine Name' },
      { id: 'vintage', label: 'Vintage' },
    ],
  },
  {
    label: 'Origin',
    columns: [
      { id: 'countryState', label: 'Country / State' },
      { id: 'regionSubRegion', label: 'Region' },
      { id: 'vineyard', label: 'Vineyard' },
    ],
  },
  {
    label: 'Wine Details',
    columns: [
      { id: 'varietal', label: 'Varietal' },
      { id: 'style', label: 'Style' },
      { id: 'format', label: 'Format' },
    ],
  },
  {
    label: 'Inventory',
    columns: [
      { id: 'quantity', label: 'Qty' },
      { id: 'storageLocation', label: 'Cellar Location' },
    ],
  },
  {
    label: 'Financials',
    columns: [
      { id: 'purchasePrice', label: 'Purchase Price' },
      { id: 'estValue', label: 'Est. Value' },
      { id: 'totalCost', label: 'Total Cost' },
      { id: 'totalEstValue', label: 'Total Value' },
    ],
  },
  {
    label: 'Ratings',
    columns: [
      { id: 'rating', label: 'Score' },
      { id: 'drinkWindowStart', label: 'Drink Start' },
      { id: 'drinkWindowEnd', label: 'Drink Until' },
    ],
  },
  {
    label: 'Notes',
    columns: [
      { id: 'notes', label: 'Notes' },
      { id: 'tastingNotes', label: 'Tasting Notes' },
      { id: 'pairingNotes', label: 'Pairing Notes' },
    ],
  },
]

// ─── FacetedFilter ───────────────────────────────────────────────────────────

interface FacetedFilterProps {
  title: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
}

function FacetedFilter({ title, options, selected, onChange }: FacetedFilterProps) {
  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-between gap-2">
          {title}
          {selected.length > 0 && (
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {selected.length}
            </Badge>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${title.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option} onSelect={() => toggle(option)}>
                  <div
                    className={cn(
                      'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                      selected.includes(option)
                        ? 'bg-primary text-primary-foreground'
                        : 'opacity-50'
                    )}
                  >
                    {selected.includes(option) && <Check className="h-3 w-3" />}
                  </div>
                  <span>{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── Column Picker ───────────────────────────────────────────────────────────

function ColumnPicker({
  table,
  onReset,
}: {
  table: Table<SerializedWine>
  onReset: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns2 className="h-3.5 w-3.5" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {COLUMN_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.columns.map(({ id, label }) => {
                  const column = table.getColumn(id)
                  if (!column) return null
                  const isVisible = column.getIsVisible()
                  return (
                    <button
                      key={id}
                      onClick={() => column.toggleVisibility()}
                      className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-accent"
                    >
                      <div
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                          isVisible ? 'bg-primary text-primary-foreground' : 'opacity-40'
                        )}
                      >
                        {isVisible && <Check className="h-3 w-3" />}
                      </div>
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 border-t border-border pt-2">
          <button
            onClick={onReset}
            className="w-full rounded-sm px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Reset to defaults
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Exports ─────────────────────────────────────────────────────────────────

const RATING_OPTIONS = [
  { label: '90+', value: 90 },
  { label: '92+', value: 92 },
  { label: '94+', value: 94 },
  { label: '96+', value: 96 },
]

export interface WineFilterOptions {
  countries: string[]
  producers: string[]
  regions: string[]
  subRegions: string[]
  varietals: string[]
  vintages: number[]
}

interface WineFiltersProps {
  table: Table<SerializedWine>
  options: WineFilterOptions
  globalFilter?: string
  onClearSearch?: () => void
  onResetColumns?: () => void
}

export function WineFilters({ table, options, globalFilter, onClearSearch, onResetColumns }: WineFiltersProps) {
  const producerFilter = (table.getColumn('producer')?.getFilterValue() as string[]) ?? []
  const countryFilter = (table.getColumn('countryState')?.getFilterValue() as string[]) ?? []
  const regionFilter = (table.getColumn('regionSubRegion')?.getFilterValue() as string[]) ?? []
  const subRegionFilter = (table.getColumn('subRegion')?.getFilterValue() as string[]) ?? []
  const varietalFilter = (table.getColumn('varietal')?.getFilterValue() as string[]) ?? []
  const ratingFilter = table.getColumn('rating')?.getFilterValue() as number | undefined
  const vintageFilter = table.getColumn('vintage')?.getFilterValue() as number | undefined

  const hasFilters =
    producerFilter.length > 0 ||
    countryFilter.length > 0 ||
    regionFilter.length > 0 ||
    subRegionFilter.length > 0 ||
    varietalFilter.length > 0 ||
    ratingFilter !== undefined ||
    vintageFilter !== undefined ||
    (globalFilter?.length ?? 0) > 0

  const clearAll = () => {
    table.getColumn('producer')?.setFilterValue(undefined)
    table.getColumn('countryState')?.setFilterValue(undefined)
    table.getColumn('regionSubRegion')?.setFilterValue(undefined)
    table.getColumn('subRegion')?.setFilterValue(undefined)
    table.getColumn('varietal')?.setFilterValue(undefined)
    table.getColumn('rating')?.setFilterValue(undefined)
    table.getColumn('vintage')?.setFilterValue(undefined)
    onClearSearch?.()
  }

  const filterContent = (
    <div className="flex flex-wrap items-center gap-2">
      <FacetedFilter
        title="Producer"
        options={options.producers}
        selected={producerFilter}
        onChange={(values) =>
          table.getColumn('producer')?.setFilterValue(values.length ? values : undefined)
        }
      />
      <FacetedFilter
        title="Country / State"
        options={options.countries}
        selected={countryFilter}
        onChange={(values) =>
          table.getColumn('countryState')?.setFilterValue(values.length ? values : undefined)
        }
      />
      <FacetedFilter
        title="Region"
        options={options.regions}
        selected={regionFilter}
        onChange={(values) =>
          table.getColumn('regionSubRegion')?.setFilterValue(values.length ? values : undefined)
        }
      />
      <FacetedFilter
        title="Sub-Region"
        options={options.subRegions}
        selected={subRegionFilter}
        onChange={(values) =>
          table.getColumn('subRegion')?.setFilterValue(values.length ? values : undefined)
        }
      />
      <FacetedFilter
        title="Varietal"
        options={options.varietals}
        selected={varietalFilter}
        onChange={(values) =>
          table.getColumn('varietal')?.setFilterValue(values.length ? values : undefined)
        }
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="justify-between gap-2">
            Rating
            {ratingFilter !== undefined && (
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {ratingFilter}+
              </Badge>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-1" align="start">
          {RATING_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() =>
                table.getColumn('rating')?.setFilterValue(
                  ratingFilter === opt.value ? undefined : opt.value
                )
              }
              className={cn(
                'flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                ratingFilter === opt.value && 'bg-accent font-medium'
              )}
            >
              {ratingFilter === opt.value && <Check className="mr-2 h-3 w-3" />}
              <span className={ratingFilter === opt.value ? '' : 'ml-5'}>{opt.label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="justify-between gap-2">
            Vintage
            {vintageFilter !== undefined && (
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {vintageFilter}
              </Badge>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-0" align="start">
          <Command>
            <CommandInput placeholder="Year..." />
            <CommandList>
              <CommandEmpty>No vintages.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={() => table.getColumn('vintage')?.setFilterValue(undefined)}
                >
                  <div className={cn('mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary', vintageFilter === undefined ? 'bg-primary text-primary-foreground' : 'opacity-50')}>
                    {vintageFilter === undefined && <Check className="h-3 w-3" />}
                  </div>
                  All
                </CommandItem>
                {options.vintages.map((yr) => (
                  <CommandItem
                    key={yr}
                    onSelect={() =>
                      table.getColumn('vintage')?.setFilterValue(
                        vintageFilter === yr ? undefined : yr
                      )
                    }
                  >
                    <div className={cn('mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary', vintageFilter === yr ? 'bg-primary text-primary-foreground' : 'opacity-50')}>
                      {vintageFilter === yr && <Check className="h-3 w-3" />}
                    </div>
                    {yr}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="gap-1 text-secondary hover:bg-secondary/10 hover:text-secondary"
        >
          <X className="h-3.5 w-3.5" />
          Clear all
        </Button>
      )}
    </div>
  )

  return (
    <div className="flex items-center gap-2">
      <div className="hidden md:block">{filterContent}</div>
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              Filters
              {hasFilters && <Badge variant="secondary">On</Badge>}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-3">{filterContent}</div>
          </SheetContent>
        </Sheet>
      </div>
      <ColumnPicker table={table} onReset={onResetColumns ?? (() => {})} />
    </div>
  )
}
