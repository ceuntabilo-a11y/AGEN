import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { rejectTeamActor } from '@/lib/agent-actor'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'
import {
  confirmClientAppointment,
  findClientAppointment,
  listClientAppointments,
  releaseClientAppointment,
  requiereIdDeReserva,
  type ReservaDelCliente,
} from '@/lib/agent-appointments'

/**
 * Herramienta del agente para las reservas del propio cliente que escribe.
 *
 * - `list`: sus próximas horas (para saber de cuál está hablando).
 * - `confirm`: el cliente dijo que sí viene → la reserva queda CONFIRMED.
 * - `release`: el cliente no puede → se cancela, el cupo queda libre y se ofrece a la lista
 *   de espera de ese servicio. Después el agente le ofrece horarios nuevos.
 *
 * Nunca actúa sobre reservas de otro cliente: siempre filtra por el teléfono que escribe.
 * Y nunca sobre "la más próxima": `confirm` y `release` exigen `appointmentId`, porque son
 * herramientas con reintento y un reintento que resolviera la reserva por proximidad podría
 * cancelar una hora distinta de la que el cliente pidió liberar.
 */

type Body = {
  businessId?: string
  phone?: string
  action?: 'list' | 'confirm' | 'release'
  appointmentId?: string
  reason?: string
}

function rangeStart(period: unknown) {
  return String(period ?? '').replace(/[[\]()"]/g, '').split(',')[0]
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as Body
  const phone = normalizePhone(body.phone)
  const action = body.action ?? 'list'
  if (!body.businessId || !isRealClientPhone(phone)) return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })
  if (!['list', 'confirm', 'release'].includes(action)) return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
  if (requiereIdDeReserva(action) && !body.appointmentId) {
    return NextResponse.json({ error: 'Falta appointmentId: primero usa mis_reservas y actúa sobre esa reserva' }, { status: 400 })
  }

  const db = createAdminClient()
  if (action !== 'list' && await rejectTeamActor(db, body.businessId, phone)) {
    return NextResponse.json({ error: 'El equipo solo puede consultar; usa el panel para gestionar reservas' }, { status: 403 })
  }

  const { data: business } = await db.from('businesses').select('id,timezone').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  const { data: client } = await db.from('clients').select('id,full_name').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()
  if (!client) return NextResponse.json({ appointments: [], error: 'Ese teléfono no tiene reservas registradas' }, { status: 404 })

  const describir = (item: ReservaDelCliente) => ({
    appointmentId: item.id,
    status: item.status,
    confirmedByClient: Boolean(item.client_confirmed_at),
    start: rangeStart(item.service_period),
    date: formatInZone(rangeStart(item.service_period), business.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
    time: formatTimeInZone(rangeStart(item.service_period), business.timezone),
    serviceName: item.service?.name ?? null,
    professionalName: item.professional?.display_name ?? null,
  })

  if (action === 'list') {
    const { data, error } = await listClientAppointments(db, { businessId: body.businessId, clientId: client.id })
    if (error) return NextResponse.json({ error: 'No se pudieron leer las reservas' }, { status: 500 })
    return NextResponse.json({ appointments: ((data ?? []) as unknown as ReservaDelCliente[]).map(describir) })
  }

  const { reserva, error: lookupError } = await findClientAppointment(db, {
    businessId: body.businessId,
    clientId: client.id,
    appointmentId: body.appointmentId!,
  })
  if (lookupError) return NextResponse.json({ error: 'No se pudieron leer las reservas' }, { status: 500 })
  if (!reserva) return NextResponse.json({ error: 'Esa reserva no es tuya o no existe' }, { status: 404 })

  if (action === 'confirm') {
    const resultado = await confirmClientAppointment(db, reserva)
    if (!resultado.ok) {
      return resultado.motivo === 'no_vigente'
        ? NextResponse.json({ error: 'Esa reserva ya no se puede confirmar' }, { status: 409 })
        : NextResponse.json({ error: 'No se pudo confirmar la reserva' }, { status: 409 })
    }
    return NextResponse.json({
      confirmed: true,
      alreadyDone: resultado.yaEstaba,
      appointment: { ...describir(reserva), status: 'CONFIRMED', confirmedByClient: true },
    })
  }

  const reason = body.reason?.trim().slice(0, 300) || 'El cliente avisó que no podía asistir'
  const resultado = await releaseClientAppointment(db, reserva, reason)
  if (!resultado.ok) {
    return resultado.motivo === 'no_vigente'
      ? NextResponse.json({ error: 'Esa reserva ya no se puede liberar' }, { status: 409 })
      : NextResponse.json({ error: 'No se pudo liberar la reserva' }, { status: 409 })
  }
  return NextResponse.json({
    released: true,
    alreadyDone: resultado.yaEstaba,
    appointment: { ...describir(reserva), status: 'CANCELLED' },
  })
}
