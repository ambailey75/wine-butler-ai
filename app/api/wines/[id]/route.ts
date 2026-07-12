import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/current-user'
import { getWine, serializeWine } from '@/lib/wines/queries'
import { updateWine, deleteWine } from '@/lib/wines/actions'
import { wineFormSchema } from '@/lib/wines/schema'
import { prisma } from '@/lib/prisma/client'

const patchSchema = z.object({
  producer: z.string().trim().min(1).optional(),
  wineName: z.string().trim().min(1).optional(),
  vintage: z.number().int().min(1800).max(new Date().getFullYear() + 1).nullable().optional(),
  country: z.string().trim().nullable().optional(),
  state: z.string().trim().nullable().optional(),
  region: z.string().trim().nullable().optional(),
  subRegion: z.string().trim().nullable().optional(),
  appellation: z.string().trim().nullable().optional(),
  vineyard: z.string().trim().nullable().optional(),
  varietal: z.string().trim().nullable().optional(),
  format: z.string().trim().nullable().optional(),
  style: z.string().trim().nullable().optional(),
  quantity: z.number().int().min(0).optional(),
  purchasePrice: z.number().min(0).nullable().optional(),
  currentEstValue: z.number().min(0).nullable().optional(),
  rating: z.number().min(0).max(100).nullable().optional(),
  drinkWindowStart: z.number().int().nullable().optional(),
  drinkWindowEnd: z.number().int().nullable().optional(),
  storageLocation: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  tastingNotes: z.string().trim().nullable().optional(),
  pairingNotes: z.string().trim().nullable().optional(),
})

interface RouteParams {
  params: { id: string }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const wine = await getWine(user.id, params.id)
  if (!wine) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(serializeWine(wine))
}

export async function PUT(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const existing = await getWine(user.id, params.id)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json()
  const parsed = wineFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await updateWine(params.id, parsed.data)
  return NextResponse.json({ id })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const existing = await getWine(user.id, params.id)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) data[key] = value
  }

  const wine = await prisma.wine.update({
    where: { id: params.id },
    data,
  })

  revalidatePath('/dashboard/cellar')
  revalidatePath(`/dashboard/cellar/${params.id}`)

  return NextResponse.json(serializeWine(wine))
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const existing = await getWine(user.id, params.id)
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await deleteWine(params.id)
  return NextResponse.json({ success: true })
}
