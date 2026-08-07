import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'
import { rejectTeamActor } from '@/lib/agent-actor'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'

/**
 * Herramienta del agente para las reservas del propio cliente que escribe.
 *
 * - `list`: sus próximas horas (para saber de cuál está hablando).
 * - `confirm`: el cliente dijo que sí viene → la reserva queda CONFIRMED.
 * - `release`: el cliente no puede → se cancela, el cupo queda libre y se ofrece a la lista
 *   de espera de ese servicio. Después el agente le ofrece horarios nuevos.
 *
 * Nunca actúa sobre reservas de otro cliente: siempre filtra por el teléfono que escribe.
 */

type Body = {
  businessId?: string
  phone?: string
  action?: 'list' | 'confirm' | 'release'
  appointmentId?: string
  reason?: string
}

const SELECT = 'id,status,service_period,client_confirmed_at,professional:professionals(display_name),service:services(name)'

function rangeStart(period: unknown) {
  return String(period ?? '').replace(/[[\]()"]/g, '').split(',')[0]
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as Body
  const phone = normalizePhone(body.phone)
  const action = body.action ?? 'list'
  if (!body.businessId || phone.length < 7) return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })
  if (!['list', 'confirm', 'release'].includes(action)) return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })

  const db = createAdminClient()
  if (action !== 'list' && await rejectTeamActor(db, body.businessId, phone)) {
    return NextResponse.json({ error: 'El equipo solo puede consultar; usa el panel para gestionar reservas' }, { status: 403 })
  }

  const { data: business } = await db.from('businesses').select('id,timezone').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  const { data: client } = await db.from('clients').select('id,full_name').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()
  if (!client) return NextResponse.json({ appointments: [], error: 'Ese teléfono no tiene reservas registradas' }, { status: 404 })

  const { data: upcoming, error } = await db.from('appointments')
    .select(SELECT)
    .eq('business_id', body.businessId).eq('client_id', client.id)
    .in('status', ['PENDING', 'CONFIRMED'])
    .overlaps('service_period', `[${new Date().toISOString()},${new Date(Date.now() + 90 * 86400000).toISOString()})`)
    .order('service_period').limit(5)
  if (error) return NextResponse.json({ error: 'No se pudieron leer las reservas' }, { status: 500 })

  const list = (upcoming ?? []).map((item: any) => ({
    appointmentId: item.id,
    status: item.status,
    confirmedByClient: Boolean(item.client_confirmed_at),
    start: rangeStart(item.service_period),
    date: formatInZone(rangeStart(item.service_period), business.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
    time: formatTimeInZone(rangeStart(item.service_period), business.timezone),
    serviceName: item.service?.name ?? null,
    professionalName: item.professional?.display_name ?? null,
  }))

  if (action === 'list') return NextResponse.json({ appointments: list })
  if (!list.length) return NextResponse.json({ error: 'No tienes reservas próximas' }, { status: 404 })

  const target = body.appointmentId ? list.find((item) => item.appointmentId === body.appointmentId) : list[0]
  if (!target) return NextResponse.json({ error: 'Esa reserva no es tuya o ya no está vigente' }, { status: 404 })

  if (action === 'confirm') {
    const { error: confirmError } = await db.rpc('confirm_appointment_by_client', { p_appointment_id: target.appointmentId })
    if (confirmError) return NextResponse.json({ error: 'No se pudo confirmar la reserva' }, { status: 409 })
    return NextResponse.json({ confirmed: true, appointment: { ...target, status: 'CONFIRMED', confirmedByClient: true } })
  }

  const reason = body.reason?.trim().slice(0, 300) || 'El cliente avisó que no podía asistir'
  const { error: cancelError } = await db.rpc('cancel_safe_appointment', {
    p_appointment_id: target.appointmentId,
    p_reason: reason,
    p_actor: 'Tú lo pediste por WhatsApp',
  })
  if (cancelError) return NextResponse.json({ error: 'No se pudo liberar la reserva' }, { status: 409 })
  return NextResponse.json({ released: true, appointment: { ...target, status: 'CANCELLED' } })
}
