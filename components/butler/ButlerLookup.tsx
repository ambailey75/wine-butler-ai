'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Search, Camera, Loader2, BookmarkPlus, Notebook, PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ButlerResult } from '@/lib/butler/types'
import { getMarkupAssessment } from '@/lib/butler/types'
import { WatchListForm } from '@/components/watchlist/WatchListForm'
import { TastingNoteForm } from '@/components/tastings/TastingNoteForm'

function formatScoreRange(min: number | null, max: number | null) {
  if (min === null && max === null) return 'N/A'
  if (min === max) return `${min}`
  return `${min}-${max}`
}

function formatPriceRange(min: number | null, max: number | null) {
  if (min === null && max === null) return 'N/A'
  const fmt = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
  if (min === max) return fmt(min!)
  return `${fmt(min!)} - ${fmt(max!)}`
}

function formatDrinkWindow(start: number | null, end: number | null) {
  if (start === null && end === null) return 'N/A'
  if (start && end) return `${start} - ${end}`
  if (start) return `${start}+`
  return `Until ${end}`
}

export function ButlerLookup() {
  const [query, setQuery] = useState('')
  const [menuPrice, setMenuPrice] = useState('')
  const [result, setResult] = useState<ButlerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/butler/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), menuPrice: menuPrice ? Number(menuPrice) : undefined }),
      })
      if (!res.ok) throw new Error('Lookup failed')
      setResult(await res.json())
    } catch {
      setError('Could not evaluate this wine. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePhoto(file: File) {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('image', file)
      if (query.trim()) formData.append('query', query.trim())
      if (menuPrice) formData.append('menuPrice', menuPrice)
      const res = await fetch('/api/butler/lookup', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Lookup failed')
      setResult(await res.json())
    } catch {
      setError('Could not evaluate this wine. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const markup =
    result && menuPrice
      ? getMarkupAssessment(Number(menuPrice), result.estimatedRetailPriceMin, result.estimatedRetailPriceMax)
      : null

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Opus One 2019, Caymus Cabernet..."
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          disabled={loading}
        />
        <Button onClick={handleSearch} disabled={loading || !query.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="flex h-auto min-h-[44px] min-w-[44px] flex-col items-center gap-0.5 py-1"
          aria-label="Scan wine label or upload photo"
        >
          <Camera className="h-4 w-4" />
          <span className="hidden text-[10px] leading-none sm:block">Upload Photo</span>
          <span className="text-[10px] leading-none sm:hidden">Scan</span>
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handlePhoto(file)
            e.target.value = ''
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        At a restaurant or wine shop? Snap a photo of the label for instant wine info.
      </p>

      <div className="max-w-[200px]">
        <Label htmlFor="menuPrice" className="text-sm text-muted-foreground">
          Menu price (optional)
        </Label>
        <Input
          id="menuPrice"
          type="number"
          value={menuPrice}
          onChange={(e) => setMenuPrice(e.target.value)}
          placeholder="$"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && (
        <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>The Butler is evaluating...</span>
        </div>
      )}

      {result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {result.producer} {result.wineName}
              {result.vintage && <span className="ml-2 font-normal text-muted-foreground">({result.vintage})</span>}
            </CardTitle>
            {(result.region || result.varietal) && (
              <p className="text-sm text-muted-foreground">
                {[result.region, result.varietal].filter(Boolean).join(' / ')}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground/80">{result.briefDescription}</p>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Critic Score</p>
                <p className="font-medium">
                  {formatScoreRange(result.estimatedCriticScoreMin, result.estimatedCriticScoreMax)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Est. Retail</p>
                <p className="font-medium">
                  {formatPriceRange(result.estimatedRetailPriceMin, result.estimatedRetailPriceMax)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Drink Window</p>
                <p className="font-medium">
                  {formatDrinkWindow(result.drinkWindowStart, result.drinkWindowEnd)}
                </p>
              </div>
            </div>

            {markup && (
              <div className="rounded-md border border-border p-3">
                <p className={`font-medium ${markup.color}`}>{markup.label}</p>
                <p className="text-sm text-muted-foreground">{markup.explanation}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <WatchListForm
                trigger={
                  <Button variant="outline" size="sm">
                    <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
                    Add to Watch List
                  </Button>
                }
                prefill={{
                  producer: result.producer,
                  wineName: result.wineName,
                  vintage: result.vintage ?? undefined,
                }}
              />
              <TastingNoteForm
                trigger={
                  <Button variant="outline" size="sm">
                    <Notebook className="mr-1.5 h-3.5 w-3.5" />
                    Rate this Wine
                  </Button>
                }
                prefill={{
                  producer: result.producer,
                  wineName: result.wineName,
                  vintage: result.vintage ?? undefined,
                }}
              />
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/cellar/new?${new URLSearchParams(
                    Object.fromEntries(
                      Object.entries({
                        producer: result.producer,
                        wineName: result.wineName,
                        vintage: result.vintage?.toString(),
                        region: result.region,
                        varietal: result.varietal,
                      }).filter(([, v]) => v != null) as [string, string][]
                    )
                  ).toString()}`}
                >
                  <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                  Add to Cellar
                </Link>
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Pricing and scores are estimates based on general knowledge, not real-time data.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
