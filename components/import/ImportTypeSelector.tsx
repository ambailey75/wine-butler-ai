'use client'

import { Clock, PackagePlus, Wine } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type ImportTypeValue = 'NEW_INVENTORY' | 'MATCH_CONSUMED' | 'HISTORICAL_CONSUMED'

const OPTIONS: {
  value: ImportTypeValue
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'NEW_INVENTORY',
    label: 'New Inventory',
    description: 'Wines currently in your cellar',
    icon: <PackagePlus className="h-6 w-6" />,
  },
  {
    value: 'MATCH_CONSUMED',
    label: 'Mark Cellar Wines Consumed',
    description: 'Match and update wines already in Wine Butler AI',
    icon: <Wine className="h-6 w-6" />,
  },
  {
    value: 'HISTORICAL_CONSUMED',
    label: 'Historical Collection',
    description: "Wines you've drunk that aren't in your cellar yet",
    icon: <Clock className="h-6 w-6" />,
  },
]

interface ImportTypeSelectorProps {
  importType: ImportTypeValue | null
  onSelect: (value: ImportTypeValue) => void
  historicalDate: string
  onDateChange: (date: string) => void
}

export function ImportTypeSelector({
  importType,
  onSelect,
  historicalDate,
  onDateChange,
}: ImportTypeSelectorProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">What are you importing?</p>
        <p className="text-xs text-muted-foreground">Select one before uploading a file</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const selected = importType === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={cn(
                'flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors',
                selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-primary/5'
              )}
            >
              <span
                className={cn(
                  'rounded-md p-1.5',
                  selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
              >
                {opt.icon}
              </span>
              <span className="text-sm font-medium text-foreground">{opt.label}</span>
              <span className="text-xs text-muted-foreground">{opt.description}</span>
            </button>
          )
        })}
      </div>

      {importType === 'HISTORICAL_CONSUMED' && (
        <div className="ml-1 flex items-center gap-4">
          <div className="space-y-1">
            <Label htmlFor="historical-date" className="text-xs text-muted-foreground">
              Date consumed (approximate)
            </Label>
            <Input
              id="historical-date"
              type="date"
              value={historicalDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="w-48"
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            All imported wines will be added to your drinking history as consumed
          </p>
        </div>
      )}
    </div>
  )
}
