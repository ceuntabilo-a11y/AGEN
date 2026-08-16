import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { rejectTeamActor } from '@/lib/agent-actor'
import { formatInZone, formatTimeInZone, instanteDelNegocio } from '@/lib/timezone'
import { motivoDeError } from '@/lib/agent-errors'
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
 * - `reschedule`: el cliente quiere la MISMA hora en otro momento → `reschedule_safe_appointment`,
 *   que revalida disponibilidad, respeta el horario del negocio y avisa al cliente con motivo.
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
  action?: 'list' | 'confirm' | 'release' | 'reschedule'
  appointmentId?: string
  reason?: string
  desiredStart?: string
  actorName?: string
}

function rangeStart(period: unknown) {
  return String(period ?? '').replace(/[[\]()"]/g, '').split(',')[0]
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as Body
  const phone = normalizePhone(body.phone)
  const action = body.action ?? 'list'
  if (!body.businessId || !isRealClientPhone(phone)) return NextResponse.json({ error: 'Negocio o teléfono inválido', motivo: 'DATO_INVALIDO' }, { status: 400 })
  if (!['list', 'confirm', 'release', 'reschedule'].includes(action)) return NextResponse.json({ error: 'Acción inválida', motivo: 'DATO_INVALIDO' }, { status: 400 })
  if (requiereIdDeReserva(action) && !body.appointmentId) {
    return NextResponse.json({ error: 'Falta appointmentId: primero usa mis_reservas y actúa sobre esa reserva', motivo: 'DATO_INVALIDO' }, { status: 400 })
  }

  const db = createAdminClient()
  if (action !== 'list' && await rejectTeamActor(db, body.businessId, phone)) {
    return NextResponse.json({ error: 'El equipo solo puede consultar; usa el panel para gestionar reservas', motivo: 'NO_AUTORIZADO' }, { status: 403 })
  }

  const { data: business } = await db.from('businesses').select('id,timezone').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente', motivo: 'NO_EXISTE' }, { status: 404 })

  const { data: client } = await db.from('clients').select('id,full_name').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()
  if (!client) return NextResponse.json({ appointments: [], error: 'Ese teléfono no tiene reservas registradas', motivo: 'NO_EXISTE' }, { status: 404 })

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
    if (error) return NextResponse.json({ error: 'No se pudieron leer las reservas', motivo: 'ERROR_TECNICO' }, { status: 500 })
    return NextResponse.json({ appointments: ((data ?? []) as unknown as ReservaDelCliente[]).map(describir), motivo: 'OK' })
  }

  const { reserva, error: lookupError } = await findClientAppointment(db, {
    businessId: body.businessId,
    clientId: client.id,
    appointmentId: body.appointmentId!,
  })
  if (lookupError) return NextResponse.json({ error: 'No se pudieron leer las reservas', motivo: 'ERROR_TECNICO' }, { status: 500 })
  if (!reserva) return NextResponse.json({ error: 'Esa reserva no es tuya o no existe', motivo: 'NO_EXISTE' }, { status: 404 })

  /*
   * Mover la hora, que hasta ahora el agente no podía hacer.
   *
   * Sin esta acción, reagendar era «liberar y volver a reservar»: dos pasos, y entre uno y otro
   * el cupo viejo se ofrecía a la lista de espera mientras el nuevo podía no existir. El cliente
   * se quedaba sin hora por pedir cambiarla.
   *
   * `reschedule_safe_appointment` lo hace en una sola transacción: cerrojo del profesional,
   * revalidación de disponibilidad, horario del negocio y aviso al cliente con motivo y autor
   * (CLAUDE.md §6.3). Mantiene servicio y profesional; para cambiar de profesional sigue
   * haciendo falta liberar y reservar de nuevo.
   */
  if (action === 'reschedule') {
    const nuevoInicio = instanteDelNegocio(body.desiredStart ?? '', business.timezone)
    if (!nuevoInicio || nuevoInicio.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'desiredStart debe ser una fecha futura válida', motivo: 'DATO_INVALIDO' }, { status: 400 })
    }
    const { data, error } = await db.rpc('reschedule_safe_appointment', {
      p_appointment_id: reserva.id,
      p_new_start: nuevoInicio.toISOString(),
      p_reason: body.reason?.trim().slice(0, 300) || 'El cliente pidió cambiar la hora',
      p_actor: body.actorName?.trim().slice(0, 120) || client.full_name || 'El cliente',
    })
    if (error) {
      const motivo = motivoDeError(error)
      return NextResponse.json(
        { error: error.message, motivo, conflict: motivo === 'CUPO_OCUPADO' },
        { status: motivo === 'ERROR_TECNICO' ? 500 : 409 },
      )
    }
    const movida = data as unknown as ReservaDelCliente | null
    return NextResponse.json({
      rescheduled: true,
      motivo: 'OK',
      appointment: movida ? describir(movida) : { ...describir(reserva), start: nuevoInicio.toISOString() },
    })
  }

  if (action === 'confirm') {
    const resultado = await confirmClientAppointment(db, reserva)
    if (!resultado.ok) {
      return resultado.motivo === 'no_vigente'
        ? NextResponse.json({ error: 'Esa reserva ya no se puede confirmar', motivo: 'CUPO_OCUPADO' }, { status: 409 })
        : NextResponse.json({ error: 'No se pudo confirmar la reserva', motivo: 'ERROR_TECNICO' }, { status: 409 })
    }
    return NextResponse.json({
      confirmed: true,
      motivo: 'OK',
      alreadyDone: resultado.yaEstaba,
      appointment: { ...describir(reserva), status: 'CONFIRMED', confirmedByClient: true },
    })
  }

  const reason = body.reason?.trim().slice(0, 300) || 'El cliente avisó que no podía asistir'
  const resultado = await releaseClientAppointment(db, reserva, reason)
  if (!resultado.ok) {
    return resultado.motivo === 'no_vigente'
      ? NextResponse.json({ error: 'Esa reserva ya no se puede liberar', motivo: 'CUPO_OCUPADO' }, { status: 409 })
      : NextResponse.json({ error: 'No se pudo liberar la reserva', motivo: 'ERROR_TECNICO' }, { status: 409 })
  }
  return NextResponse.json({
    released: true,
    motivo: 'OK',
    alreadyDone: resultado.yaEstaba,
    appointment: { ...describir(reserva), status: 'CANCELLED' },
  })
}
