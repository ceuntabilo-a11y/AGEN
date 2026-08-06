import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

const METHODS = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO']

export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const status = new URL(request.url).searchParams.get('status')
    let builder = db.from('payments').select('id,amount,status,method,paid_at,created_at,client:clients(id,full_name),appointment_id,quote_id').eq('business_id', businessId).order('created_at', { ascending: false }).limit(100)
    if (status) builder = builder.eq('status', status)
    const { data, error } = await builder
    if (error) throw error
    return NextResponse.json({ payments: data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const body = await request.json() as { clientId?: string; amount?: number; method?: string; status?: string; paidAt?: string; appointmentId?: string | null; quoteId?: string | null; reference?: string }
    if (!body.clientId) return NextResponse.json({ error: 'El cliente es obligatorio' }, { status: 400 })
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'El monto debe ser mayor que cero' }, { status: 400 })
    const method = body.method && METHODS.includes(body.method) ? body.method : 'EFECTIVO'
    const status = body.status === 'PENDING' ? 'PENDING' : 'PAID'
    const { data: client, error: clientError } = await db.from('clients').select('id').eq('business_id', businessId).eq('id', body.clientId).maybeSingle()
    if (clientError) throw clientError
    if (!client) return NextResponse.json({ error: 'Ese cliente no pertenece al negocio' }, { status: 404 })
    const paidAt = status === 'PAID' ? (body.paidAt ? new Date(body.paidAt) : new Date()) : null
    if (paidAt && Number.isNaN(paidAt.getTime())) return NextResponse.json({ error: 'Fecha de pago inválida' }, { status: 400 })
    const { data, error } = await db.from('payments').insert({
      business_id: businessId,
      client_id: body.clientId,
      appointment_id: body.appointmentId ?? null,
      quote_id: body.quoteId ?? null,
      amount,
      status,
      method,
      external_reference: body.reference?.trim().slice(0, 160) || null,
      paid_at: paidAt ? paidAt.toISOString() : null,
    }).select('id,amount,status,method,paid_at').single()
    if (error) throw error
    return NextResponse.json({ payment: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}

/** Marca un cobro pendiente como pagado, o al revés. */
export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const body = await request.json() as { id?: string; status?: string }
    if (!body.id || !body.status) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    if (!['PENDING', 'PAID', 'REFUNDED', 'FAILED'].includes(body.status)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    const changes: Record<string, unknown> = { status: body.status, paid_at: body.status === 'PAID' ? new Date().toISOString() : null }
    const { data, error } = await db.from('payments').update(changes).eq('id', body.id).eq('business_id', businessId).select('id,status,paid_at').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Ese cobro no pertenece al negocio' }, { status: 404 })
    return NextResponse.json({ payment: data })
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta el cobro' }, { status: 400 })
    const { data, error } = await db.from('payments').delete().eq('id', id).eq('business_id', businessId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Ese cobro no pertenece al negocio' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
