'use client'

import { Check, ChevronsUpDown, Filter, X } from 'lucide-react'
import type { Table } from '@tanstack/react-table'
import type { SerializedWine } from '@/lib/wines/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

const RATING_OPTIONS = [
  { label: '90+', value: 90 },
  { label: '92+', value: 92 },
  { label: '94+', value: 94 },
  { label: '96+', value: 96 },
]

export interface WineFilterOptions {
  styles: string[]
  formats: string[]
}

interface WineFiltersProps {
  table: Table<SerializedWine>
  options: WineFilterOptions
}

export function WineFilters({ table, options }: WineFiltersProps) {
  const styleFilter = (table.getColumn('style')?.getFilterValue() as string[]) ?? []
  const formatFilter = (table.getColumn('format')?.getFilterValue() as string[]) ?? []
  const ratingFilter = table.getColumn('rating')?.getFilterValue() as number | undefined
  const vintageFilter =
    (table.getColumn('vintage')?.getFilterValue() as
      | [number | undefined, number | undefined]
      | undefined) ?? []
  const [vintageMin, vintageMax] = vintageFilter

  const hasFilters =
    styleFilter.length > 0 ||
    formatFilter.length > 0 ||
    ratingFilter !== undefined ||
    vintageMin !== undefined ||
    vintageMax !== undefined

  const clearAll = () => {
    table.getColumn('style')?.setFilterValue(undefined)
    table.getColumn('format')?.setFilterValue(undefined)
    table.getColumn('rating')?.setFilterValue(undefined)
    table.getColumn('vintage')?.setFilterValue(undefined)
  }

  const content = (
    <div className="flex flex-wrap items-center gap-2">
      <FacetedFilter
        title="Style"
        options={options.styles}
        selected={styleFilter}
        onChange={(values) =>
          table.getColumn('style')?.setFilterValue(values.length ? values : undefined)
        }
      />
      <FacetedFilter
        title="Format"
        options={options.formats}
        selected={formatFilter}
        onChange={(values) =>
          table.getColumn('format')?.setFilterValue(values.length ? values : undefined)
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
      <div className="flex items-center gap-2">
        <Label htmlFor="vintage-min" className="text-xs text-muted-foreground">
          Vintage
        </Label>
        <Input
          id="vintage-min"
          type="number"
          placeholder="From"
          className="h-9 w-20"
          value={vintageMin ?? ''}
          onChange={(e) => {
            const min = e.target.value ? Number(e.target.value) : undefined
            table.getColumn('vintage')?.setFilterValue([min, vintageMax])
          }}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="number"
          placeholder="To"
          className="h-9 w-20"
          value={vintageMax ?? ''}
          onChange={(e) => {
            const max = e.target.value ? Number(e.target.value) : undefined
            table.getColumn('vintage')?.setFilterValue([vintageMin, max])
          }}
        />
      </div>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1">
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  )

  return (
    <>
      <div className="hidden md:block">{content}</div>
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
            <div className="mt-4 flex flex-col gap-3">{content}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
