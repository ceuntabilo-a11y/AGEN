import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { dateKeyInZone, validTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { data, error } = await db.from('expenses').select('id,category,description,amount,incurred_on,professional:professionals(id,display_name)').eq('business_id', businessId).order('incurred_on', { ascending: false }).limit(100)
    if (error) throw error
    return NextResponse.json({ expenses: data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as { category?: string; description?: string; amount?: number; incurredOn?: string; professionalId?: string | null }
    if (!body.category?.trim() || !body.description?.trim()) return NextResponse.json({ error: 'Categoría y descripción son obligatorias' }, { status: 400 })
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'El monto debe ser mayor que cero' }, { status: 400 })
    if (body.incurredOn && !/^\d{4}-\d{2}-\d{2}$/.test(body.incurredOn)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    const { data: business } = await db.from('businesses').select('timezone').eq('id', businessId).single()
    const timezone = validTimeZone(business?.timezone) ? business!.timezone : 'America/Santiago'
    const { data, error } = await db.from('expenses').insert({
      business_id: businessId,
      category: body.category.trim().slice(0, 80),
      description: body.description.trim().slice(0, 300),
      amount,
      incurred_on: body.incurredOn || dateKeyInZone(new Date(), timezone),
      professional_id: body.professionalId ?? null,
    }).select('id,category,description,amount,incurred_on').single()
    if (error) throw error
    return NextResponse.json({ expense: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta el gasto' }, { status: 400 })
    const { data, error } = await db.from('expenses').delete().eq('id', id).eq('business_id', businessId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Ese gasto no pertenece al negocio' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
