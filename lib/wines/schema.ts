import { z } from 'zod'

const currentYear = new Date().getFullYear()

export const wineFormSchema = z.object({
  producer: z.string().trim().min(1, 'Producer is required'),
  wineName: z.string().trim().min(1, 'Wine name is required'),
  vintage: z
    .number()
    .int('Vintage must be a whole year')
    .min(1800, 'Vintage must be after 1800')
    .max(currentYear + 1, `Vintage cannot be after ${currentYear + 1}`)
    .optional(),
  country: z.string().trim().optional(),
  state: z.string().trim().optional(),
  region: z.string().trim().optional(),
  subRegion: z.string().trim().optional(),
  appellation: z.string().trim().optional(),
  vineyard: z.string().trim().optional(),
  classification: z.string().trim().optional(),
  varietal: z.string().trim().optional(),
  format: z.string().trim().optional(),
  style: z.string().trim().optional(),
  quantity: z
    .number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity cannot be negative'),
  purchasePrice: z.number().min(0, 'Price cannot be negative').optional(),
  purchaseDate: z.date().optional(),
  vendor: z.string().trim().optional(),
  storageLocation: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  tastingNotes: z.string().trim().optional(),
  pairingNotes: z.string().trim().optional(),
  rating: z
    .number()
    .min(0, 'Rating must be between 0 and 100')
    .max(100, 'Rating must be between 0 and 100')
    .optional(),
  drinkWindowStart: z.number().int('Year must be a whole number').optional(),
  drinkWindowEnd: z.number().int('Year must be a whole number').optional(),
  currentEstValue: z.number().min(0, 'Value cannot be negative').optional(),
  wineId: z.string().trim().optional(),
})

export type WineFormValues = z.infer<typeof wineFormSchema>

export const wineFormDefaultValues: WineFormValues = {
  producer: '',
  wineName: '',
  vintage: undefined,
  country: undefined,
  state: undefined,
  region: undefined,
  subRegion: undefined,
  appellation: undefined,
  vineyard: undefined,
  classification: undefined,
  varietal: undefined,
  format: undefined,
  style: undefined,
  quantity: 1,
  purchasePrice: undefined,
  purchaseDate: undefined,
  vendor: undefined,
  storageLocation: undefined,
  notes: undefined,
  tastingNotes: undefined,
  pairingNotes: undefined,
  rating: undefined,
  drinkWindowStart: undefined,
  drinkWindowEnd: undefined,
  currentEstValue: undefined,
  wineId: undefined,
}
