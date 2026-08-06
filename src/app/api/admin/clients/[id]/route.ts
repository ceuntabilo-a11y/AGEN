import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, businessId } = await requireBusinessContext()
    const { id } = await params
    const { data: client, error } = await db.from('clients')
      .select('id,full_name,phone,email,birthday,notes,marketing_opt_in,created_at,client_memory(preferred_professional_id,preferred_service_id,preferences,known_facts,conversation_summary,last_intent,last_interaction_at)')
      .eq('business_id', businessId).eq('id', id).maybeSingle()
    if (error) throw error
    if (!client) return NextResponse.json({ error: 'Ese cliente no pertenece al negocio' }, { status: 404 })

    const [appointments, consents, quotes, payments, business] = await Promise.all([
      db.from('appointments').select('id,status,service_period,quoted_price,notes,service:services(id,name),professional:professionals(id,display_name,color)').eq('business_id', businessId).eq('client_id', id).order('service_period', { ascending: false }).limit(50),
      db.from('communication_consents').select('channel,purpose,granted,updated_at').eq('client_id', id),
      db.from('quotes').select('id,status,total,created_at,valid_until').eq('business_id', businessId).eq('client_id', id).order('created_at', { ascending: false }).limit(20),
      db.from('payments').select('id,amount,status,method,paid_at,created_at').eq('business_id', businessId).eq('client_id', id).order('created_at', { ascending: false }).limit(20),
      db.from('businesses').select('timezone,currency').eq('id', businessId).single(),
    ])
    const failure = appointments.error || consents.error || quotes.error || payments.error || business.error
    if (failure) throw failure

    const rows = appointments.data ?? []
    const paid = (payments.data ?? []).filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount), 0)
    return NextResponse.json({
      client,
      appointments: rows,
      consents: consents.data ?? [],
      quotes: quotes.data ?? [],
      payments: payments.data ?? [],
      stats: {
        total: rows.length,
        completed: rows.filter((row) => row.status === 'COMPLETED').length,
        cancelled: rows.filter((row) => row.status === 'CANCELLED').length,
        noShow: rows.filter((row) => row.status === 'NO_SHOW').length,
        paid,
      },
      timezone: business.data?.timezone ?? 'America/Santiago',
      currency: business.data?.currency ?? 'CLP',
    })
  } catch (error) { return apiError(error) }
}

/** Consentimientos por canal: el marketing solo sale con permiso vigente. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const { id } = await params
    const body = await request.json() as { channel?: string; purpose?: string; granted?: boolean }
    const channels = ['WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'EMAIL', 'PUSH', 'SMS']
    const purposes = ['TRANSACTIONAL', 'MARKETING']
    if (!body.channel || !channels.includes(body.channel)) return NextResponse.json({ error: 'Canal inválido' }, { status: 400 })
    if (!body.purpose || !purposes.includes(body.purpose)) return NextResponse.json({ error: 'Propósito inválido' }, { status: 400 })
    if (typeof body.granted !== 'boolean') return NextResponse.json({ error: 'Falta el consentimiento' }, { status: 400 })
    const { data: client, error: clientError } = await db.from('clients').select('id').eq('business_id', businessId).eq('id', id).maybeSingle()
    if (clientError) throw clientError
    if (!client) return NextResponse.json({ error: 'Ese cliente no pertenece al negocio' }, { status: 404 })
    const { error } = await db.from('communication_consents').upsert({ client_id: id, channel: body.channel, purpose: body.purpose, granted: body.granted, source: 'ADMIN', updated_at: new Date().toISOString() }, { onConflict: 'client_id,channel,purpose' })
    if (error) throw error
    const { data } = await db.from('communication_consents').select('channel,purpose,granted,updated_at').eq('client_id', id)
    return NextResponse.json({ consents: data ?? [] })
  } catch (error) { return apiError(error) }
}
