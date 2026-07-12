'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format as formatDate, isValid, parse } from 'date-fns'
import { Calendar as CalendarIcon, Check, ChevronsUpDown, Plus, X } from 'lucide-react'
import {
  wineFormSchema,
  wineFormDefaultValues,
  type WineFormValues,
} from '@/lib/wines/schema'
import { COUNTRIES, WINE_FORMATS, WINE_STYLES, COMMON_REGIONS, COMMON_VARIETALS, COMMON_STATES } from '@/lib/wines/constants'
import type { SerializedWine } from '@/lib/wines/queries'
import { createWine, updateWine, searchCellarWines, type WineSuggestion } from '@/lib/wines/actions'
import { searchStaticWines, type StaticWineEntry } from '@/lib/wines/staticWineSearch'
import type { WineLookupResult } from '@/lib/wines/types'
import { ProducerThumbnail } from '@/components/cellar/ProducerThumbnail'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

interface ComboboxFieldProps {
  value: string | undefined
  onChange: (value: string | undefined) => void
  options: string[]
  placeholder: string
}

function ComboboxField({ value, onChange, options, placeholder }: ComboboxFieldProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(search.toLowerCase())
  )

  const trimmedSearch = search.trim()
  const showCreate =
    trimmedSearch.length > 0 &&
    !options.some((option) => option.toLowerCase() === trimmedSearch.toLowerCase())

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={() => {
                    onChange(undefined)
                    setOpen(false)
                    setSearch('')
                  }}
                  className="text-muted-foreground"
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear selection
                </CommandItem>
              )}
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option}
                  onSelect={() => {
                    onChange(option)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === option ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option}
                </CommandItem>
              ))}
              {showCreate && (
                <CommandItem
                  onSelect={() => {
                    onChange(trimmedSearch)
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Use &quot;{trimmedSearch}&quot;
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface PurchaseDateFieldProps {
  value: Date | undefined
  onChange: (value: Date | undefined) => void
}

function PurchaseDateField({ value, onChange }: PurchaseDateFieldProps) {
  const [open, setOpen] = useState(false)
  const [textValue, setTextValue] = useState(value ? formatDate(value, 'MM/dd/yyyy') : '')

  useEffect(() => {
    setTextValue(value ? formatDate(value, 'MM/dd/yyyy') : '')
  }, [value])

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setTextValue(raw)

    const trimmed = raw.trim()
    if (trimmed === '') {
      onChange(undefined)
      return
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const parsed = parse(trimmed, 'M/d/yyyy', new Date())
      if (isValid(parsed) && parsed <= new Date()) {
        onChange(parsed)
      }
      return
    }

    if (/^\d{4}$/.test(trimmed)) {
      const parsed = new Date(Number(trimmed), 0, 1)
      if (isValid(parsed) && parsed <= new Date()) {
        onChange(parsed)
      }
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative flex items-center">
        <Input
          placeholder="MM/DD/YYYY or YYYY"
          value={textValue}
          onChange={handleTextChange}
          className="pr-10"
        />
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 h-9 w-9 text-muted-foreground hover:text-foreground"
          >
            <CalendarIcon className="h-4 w-4" />
            <span className="sr-only">Open calendar</span>
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date)
            setOpen(false)
          }}
          disabled={(date) => date > new Date()}
          captionLayout="dropdown"
          startMonth={new Date(1900, 0)}
          endMonth={new Date()}
          defaultMonth={value ?? new Date()}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

interface MergedSuggestion {
  source: 'cellar' | 'static' | 'api'
  producer: string
  wineName: string
  vintage: number | null
  country: string | null
  state: string | null
  region: string | null
  subRegion: string | null
  appellation: string | null
  vineyard: string | null
  classification: string | null
  varietal: string | null
  format: string | null
}

function fromCellar(suggestion: WineSuggestion): MergedSuggestion {
  return { source: 'cellar', ...suggestion }
}

function fromStatic(entry: StaticWineEntry): MergedSuggestion {
  return { source: 'static', vintage: null, appellation: null, ...entry }
}

function fromApi(result: WineLookupResult): MergedSuggestion {
  return { source: 'api', state: null, subRegion: null, appellation: null, vineyard: null, classification: null, format: null, ...result }
}

function mergeSuggestions(...lists: MergedSuggestion[][]): MergedSuggestion[] {
  const seen = new Set<string>()
  const merged: MergedSuggestion[] = []
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.producer.toLowerCase()}|${item.wineName.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(item)
      if (merged.length >= 6) return merged
    }
  }
  return merged
}

interface WineFormPrefill {
  producer?: string
  wineName?: string
  vintage?: number
  country?: string
  region?: string
  varietal?: string
}

interface WineFormProps {
  mode: 'create' | 'edit'
  wine?: SerializedWine
  existingRegions: string[]
  existingVarietals: string[]
  prefill?: WineFormPrefill
}

export function WineForm({ mode, wine, existingRegions, existingVarietals, prefill }: WineFormProps) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const regionOptions = useMemo(
    () => Array.from(new Set([...COMMON_REGIONS, ...existingRegions])).sort(),
    [existingRegions]
  )
  const varietalOptions = useMemo(
    () => Array.from(new Set([...COMMON_VARIETALS, ...existingVarietals])).sort(),
    [existingVarietals]
  )

  const form = useForm<WineFormValues>({
    resolver: zodResolver(wineFormSchema),
    defaultValues: prefill && !wine
      ? { ...wineFormDefaultValues, ...prefill }
      : wine
      ? {
          producer: wine.producer,
          wineName: wine.wineName,
          vintage: wine.vintage ?? undefined,
          country: wine.country ?? undefined,
          state: wine.state ?? undefined,
          region: wine.region ?? undefined,
          subRegion: wine.subRegion ?? undefined,
          appellation: wine.appellation ?? undefined,
          vineyard: wine.vineyard ?? undefined,
          classification: wine.classification ?? undefined,
          varietal: wine.varietal ?? undefined,
          format: wine.format ?? undefined,
          style: wine.style ?? undefined,
          quantity: wine.quantity,
          purchasePrice: wine.purchasePrice ?? undefined,
          purchaseDate: wine.purchaseDate ?? undefined,
          vendor: wine.vendor ?? undefined,
          storageLocation: wine.storageLocation ?? undefined,
          notes: wine.notes ?? undefined,
          tastingNotes: wine.tastingNotes ?? undefined,
          pairingNotes: wine.pairingNotes ?? undefined,
          rating: wine.rating ?? undefined,
          drinkWindowStart: wine.drinkWindowStart ?? undefined,
          drinkWindowEnd: wine.drinkWindowEnd ?? undefined,
          currentEstValue: wine.currentEstValue ?? undefined,
          wineId: wine.wineId ?? undefined,
        }
      : wineFormDefaultValues,
  })

  async function onSubmit(values: WineFormValues) {
    setServerError(null)
    try {
      const result =
        mode === 'create' || !wine
          ? await createWine(values)
          : await updateWine(wine.id, values)
      router.push(`/dashboard/cellar/${result.id}`)
    } catch (error) {
      console.error(error)
      setServerError('Something went wrong saving this wine. Please try again.')
    }
  }

  const [suggestions, setSuggestions] = useState<MergedSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const producerValue = form.watch('producer')
  const wineNameValue = form.watch('wineName')

  useEffect(() => {
    if (mode !== 'create') return

    const producer = producerValue?.trim() ?? ''
    const wineName = wineNameValue?.trim() ?? ''

    if (producer.length < 2 && wineName.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    let cancelled = false
    const query = [producer, wineName].filter(Boolean).join(' ')

    const timeout = setTimeout(async () => {
      const [cellarResults, staticResults] = await Promise.all([
        searchCellarWines({ producer, wineName }),
        searchStaticWines(query),
      ])
      if (cancelled) return

      const merged = mergeSuggestions(cellarResults.map(fromCellar), staticResults.map(fromStatic))
      setSuggestions(merged)
      setShowSuggestions(merged.length > 0)

      const apiResults = await Promise.race([
        fetch(`/api/wines/lookup?q=${encodeURIComponent(query)}`)
          .then((res) => (res.ok ? res.json() : []))
          .catch(() => []),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
      ])
      if (cancelled || !apiResults) return

      const withApi = mergeSuggestions(merged, (apiResults as WineLookupResult[]).map(fromApi))
      setSuggestions(withApi)
      setShowSuggestions(withApi.length > 0)
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [producerValue, wineNameValue, mode])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function applySuggestion(suggestion: MergedSuggestion) {
    form.setValue('producer', suggestion.producer)
    form.setValue('wineName', suggestion.wineName)
    if (suggestion.vintage != null) form.setValue('vintage', suggestion.vintage)
    if (suggestion.country) form.setValue('country', suggestion.country)
    if (suggestion.state) form.setValue('state', suggestion.state)
    if (suggestion.region) form.setValue('region', suggestion.region)
    if (suggestion.subRegion) form.setValue('subRegion', suggestion.subRegion)
    if (suggestion.appellation) form.setValue('appellation', suggestion.appellation)
    if (suggestion.vineyard) form.setValue('vineyard', suggestion.vineyard)
    if (suggestion.classification) form.setValue('classification', suggestion.classification)
    if (suggestion.varietal) form.setValue('varietal', suggestion.varietal)
    if (suggestion.format) form.setValue('format', suggestion.format)
    setShowSuggestions(false)
    setSuggestions([])
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div ref={suggestionsRef} className="relative grid gap-4 sm:col-span-2 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="producer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Producer *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Château Margaux" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="wineName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Wine Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Grand Vin" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                  <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Suggestions — select to fill in details
                  </div>
                  <ul className="max-h-60 overflow-auto">
                    {suggestions.map((suggestion, index) => (
                      <li key={index}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applySuggestion(suggestion)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                        >
                          <ProducerThumbnail producer={suggestion.producer} size={32} />
                          <span className="flex flex-1 items-start justify-between gap-2">
                            <span className="flex flex-col items-start gap-0.5">
                              <span className="font-medium">
                                {suggestion.producer} — {suggestion.wineName}
                                {suggestion.vintage ? ` (${suggestion.vintage})` : ''}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {[suggestion.region, suggestion.country].filter(Boolean).join(', ') ||
                                  'No region or country on file'}
                              </span>
                            </span>
                            {suggestion.source === 'cellar' && (
                              <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                                Your cellar
                              </Badge>
                            )}
                            {suggestion.source === 'api' && (
                              <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                                Live
                              </Badge>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <FormField
              control={form.control}
              name="vintage"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Vintage</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="e.g. 2018"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        onChange(raw === '' ? undefined : Number(raw))
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantity"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Quantity *</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        onChange(raw === '' ? undefined : Number(raw))
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="format"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Format</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a bottle size" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {WINE_FORMATS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="style"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Style</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a style" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {WINE_STYLES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Origin &amp; Classification</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Country</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a country" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {COUNTRIES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State/Province</FormLabel>
                  <ComboboxField
                    value={field.value}
                    onChange={field.onChange}
                    options={COMMON_STATES}
                    placeholder="Select or type a state"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="varietal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Varietal</FormLabel>
                  <ComboboxField
                    value={field.value}
                    onChange={field.onChange}
                    options={varietalOptions}
                    placeholder="Select or type a varietal"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="region"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <ComboboxField
                    value={field.value}
                    onChange={field.onChange}
                    options={regionOptions}
                    placeholder="Select or type a region"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="subRegion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub-Region</FormLabel>
                  <ComboboxField
                    value={field.value}
                    onChange={field.onChange}
                    options={regionOptions}
                    placeholder="Select or type a sub-region"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="appellation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Appellation</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Stags Leap District AVA, Châteauneuf-du-Pape AOC"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vineyard"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vineyard</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. To Kalon, Beckstoffer Georges III" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="classification"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Classification</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Grand Cru, 1er Cru, DOCG" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>
                    Appellation tier, classification, or designation.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Purchase Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="purchasePrice"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Purchase Price</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        className="pl-7"
                        placeholder="0.00"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          onChange(raw === '' ? undefined : Number(raw))
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="purchaseDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Purchase Date</FormLabel>
                  <FormControl>
                    <PurchaseDateField value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>
                    Type MM/DD/YYYY, or just a year (e.g. 2015) for older vintages.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vendor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. K&L Wine Merchants" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="storageLocation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Storage Location</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Cellar rack 3, bin 12" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currentEstValue"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Current Est. Value</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        $
                      </span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        className="pl-7"
                        placeholder="0.00"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          onChange(raw === '' ? undefined : Number(raw))
                        }}
                      />
                    </div>
                  </FormControl>
                  <FormDescription>Current estimated market value per bottle.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="wineId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Your Wine ID</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. ID from your own records" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasting &amp; Drinking Window</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="rating"
              render={({ field: { onChange, ...field } }) => (
                <FormItem>
                  <FormLabel>Rating</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min={0}
                      max={100}
                      placeholder="e.g. 94"
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        onChange(raw === '' ? undefined : Number(raw))
                      }}
                    />
                  </FormControl>
                  <FormDescription>Score out of 100.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="drinkWindowStart"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>Drink Window Start</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder="e.g. 2026"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          onChange(raw === '' ? undefined : Number(raw))
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="drinkWindowEnd"
                render={({ field: { onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>Drink Window End</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder="e.g. 2032"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          onChange(raw === '' ? undefined : Number(raw))
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="tastingNotes"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Tasting Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Aromas, flavors, structure..."
                      className="min-h-24"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="pairingNotes"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Pairing Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Foods that pair well with this bottle..."
                      className="min-h-24"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder="Gift occasion, special memories, anything worth remembering..."
                      className="min-h-24"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}

        <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? 'Saving...'
              : mode === 'create'
                ? 'Add Wine'
                : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
