import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const { data, error } = await db.from('membership_plans').select('*').order('price', { ascending: true })
    if (error) throw error
    return NextResponse.json({ plans: data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as { code?: string; name?: string; maxProfessionals?: number | null; price?: number; currency?: string }
    if (!body.code?.trim() || !body.name?.trim()) return NextResponse.json({ error: 'Código y nombre son obligatorios' }, { status: 400 })
    const { data, error } = await db.from('membership_plans').insert({ code: body.code.trim().toUpperCase(), name: body.name.trim(), max_professionals: body.maxProfessionals ?? null, price: body.price ?? 0, currency: (body.currency || 'CLP').toUpperCase() }).select().single()
    if (error) { if (error.code === '23505') return NextResponse.json({ error: 'Ese código ya existe' }, { status: 409 }); throw error }
    return NextResponse.json({ plan: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as { id?: string; name?: string; maxProfessionals?: number | null; price?: number; active?: boolean }
    if (!body.id) return NextResponse.json({ error: 'Falta el plan' }, { status: 400 })
    const changes: Record<string, unknown> = {}
    if (body.name !== undefined) changes.name = body.name
    if (body.maxProfessionals !== undefined) changes.max_professionals = body.maxProfessionals
    if (body.price !== undefined) changes.price = body.price
    if (body.active !== undefined) changes.active = body.active
    const { data, error } = await db.from('membership_plans').update(changes).eq('id', body.id).select().single()
    if (error) throw error
    return NextResponse.json({ plan: data })
  } catch (error) { return apiError(error) }
}
