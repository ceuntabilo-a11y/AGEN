import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { rejectTeamActor } from '@/lib/agent-actor'
import { guardarClienteDelAgente, reservarConApartado } from '@/lib/agent-booking'
import { confirmClientAppointment, findClientAppointment, listClientAppointments, releaseClientAppointment, type ReservaDelCliente } from '@/lib/agent-appointments'
import { escalarConAviso, MOTIVOS_ESCALACION, type MotivoEscalacion } from '@/lib/agent-escalation'
import { motivoDeError } from '@/lib/agent-errors'
import { registrarAviso } from '@/lib/observabilidad'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'
import { preguntaPorElDato, siguienteDatoQueFalta, type EstadoDelTurno } from '@/lib/agent-router'
import {
  conPeticionDeDato, TEXTO_CUPO_OCUPADO, TEXTO_NO_SE_PUDO, TEXTO_SIN_RESERVAS,
  textoEquipoAvisado, textoReservaCancelada, textoReservaConfirmada, textoReservaHecha,
  textoReservaMovida, textoVariasReservas, textoYaEstabaCancelada, textoYaEstabaConfirmada,
} from '@/lib/agent-textos'

export const dynamic = 'force-dynamic'

/**
 * El ejecutor. Aquí, y SOLO aquí, ocurren las acciones del agente.
 *
 * El modelo no llama a esta ruta: la llama n8n con el JSON que el decisor produjo. Y esta ruta
 * no se fía de ese JSON: vuelve a leer de la base quién es el cliente, qué reservas vigentes
 * tiene y qué apartados siguen vivos, y **solo** acepta identificadores que estén en esas
 * listas. Si algo no cuadra, no ejecuta nada y devuelve una pregunta.
 *
 * Tres reglas que no dependen de la buena conducta de ningún modelo:
 *
 * 1. Sin `confirmado: true` no se ejecuta absolutamente nada.
 * 2. Un `appointmentId` o un `holdId` que no pertenezcan a este cliente y a este negocio se
 *    descartan; nunca se resuelve «la más próxima» por proximidad.
 * 3. El texto que recibe el cliente lo escribe esta ruta con los datos que devolvió la base,
 *    no con lo que dijo el modelo ni con lo que escribió el cliente.
 */

type Decision = {
  intencion?: string
  holdId?: string | null
  appointmentId?: string | null
  reason?: string | null
  razonEscalar?: string | null
  datos?: { nombre?: string | null; correo?: string | null; nacimiento?: string | null } | null
  confirmado?: boolean
  mensaje?: string | null
}

const INTENCIONES = ['RESERVAR', 'CANCELAR', 'MOVER', 'CONFIRMAR', 'ESCALAR', 'NINGUNA']

/** El decisor puede devolver el JSON envuelto en texto o en vallas de código. */
function leerDecision(bruto: unknown): Decision | null {
  if (bruto && typeof bruto === 'object') return bruto as Decision
  const texto = String(bruto ?? '').trim()
  if (!texto) return null
  const limpio = texto.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const inicio = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  if (inicio < 0 || fin <= inicio) return null
  try { return JSON.parse(limpio.slice(inicio, fin + 1)) as Decision } catch { return null }
}

const rangoInicio = (period: unknown) => String(period ?? '').replace(/[[\]()"]/g, '').split(',')[0]

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json() as { businessId?: string; phone?: string; decision?: unknown }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) {
    return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: business } = await db.from('businesses')
    .select('id,name,phone,timezone').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })
  const timezone: string = business.timezone ?? 'America/Santiago'

  const responder = (texto: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ejecutado: false, text: texto, ...extra })

  const decision = leerDecision(body.decision)
  if (!decision) {
    registrarAviso('agente_decision_ilegible', { businessId: body.businessId })
    return responder('Perdona, no me quedó claro. ¿Me lo dices con otras palabras?', { motivo: 'DECISION_ILEGIBLE' })
  }

  const intencion = INTENCIONES.includes(String(decision.intencion ?? '').toUpperCase())
    ? String(decision.intencion).toUpperCase()
    : 'NINGUNA'

  // El equipo nunca muta nada desde el agente: doble guardia, igual que en las rutas antiguas.
  if (intencion !== 'NINGUNA' && await rejectTeamActor(db, body.businessId, phone)) {
    return responder('Desde aquí no puedo gestionar reservas del equipo; usa el panel.', { motivo: 'NO_AUTORIZADO' })
  }

  const { data: cliente } = await db.from('clients')
    .select('id,full_name,email,birthday').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()

  /*
   * Los datos que el cliente dio se guardan SIEMPRE, confirme o no la acción. Un correo dicho
   * en un mensaje que además pregunta otra cosa no se puede perder: es justo el dato que el
   * negocio necesita para avisarle si hay una cancelación.
   */
  const datosDichos = decision.datos ?? {}
  let clienteActual = cliente
  if (datosDichos.nombre || datosDichos.correo || datosDichos.nacimiento) {
    const guardado = await guardarClienteDelAgente(db, {
      businessId: body.businessId, phone,
      fullName: datosDichos.nombre ?? undefined,
      email: datosDichos.correo ?? undefined,
      birthday: datosDichos.nacimiento ?? undefined,
    })
    if (guardado.ok) {
      clienteActual = {
        id: String(guardado.client.id ?? cliente?.id ?? ''),
        full_name: (guardado.client.full_name as string | null) ?? cliente?.full_name ?? null,
        email: (guardado.client.email as string | null) ?? cliente?.email ?? null,
        birthday: (guardado.client.birthday as string | null) ?? cliente?.birthday ?? null,
      } as typeof cliente
    }
  }

  const estadoDatos = {
    nombreCliente: clienteActual?.full_name ?? null,
    correoCliente: clienteActual?.email ?? null,
    nacimientoCliente: clienteActual?.birthday ?? null,
  } as EstadoDelTurno
  const pedirDato = () => preguntaPorElDato(siguienteDatoQueFalta(estadoDatos))

  if (intencion === 'NINGUNA' || decision.confirmado !== true) {
    const pregunta = String(decision.mensaje ?? '').trim()
    return responder(pregunta || 'Cuéntame, ¿qué te gustaría hacer con tu hora?', { motivo: 'SIN_CONFIRMAR' })
  }

  /* ───────────────────────────── ESCALAR ───────────────────────────── */

  if (intencion === 'ESCALAR') {
    const motivo = MOTIVOS_ESCALACION.includes(String(decision.razonEscalar) as MotivoEscalacion)
      ? String(decision.razonEscalar) as MotivoEscalacion
      : 'PETICION_CLIENTE'
    const resultado = await escalarConAviso(db, {
      businessId: body.businessId, phone, motivo,
      detalle: String(decision.reason ?? decision.mensaje ?? 'El cliente pidió hablar con una persona').slice(0, 1000),
      businessPhone: business.phone ?? null,
      clientId: clienteActual?.id ?? null,
      clientName: clienteActual?.full_name ?? null,
    })
    return NextResponse.json({
      ejecutado: resultado.escalated,
      text: textoEquipoAvisado(resultado.escalated, business.phone ?? null),
      motivo: resultado.escalated ? 'OK' : 'SIN_EQUIPO',
    })
  }

  if (!clienteActual?.id) {
    return responder(conPeticionDeDato('Para poder dejar tu hora necesito tu nombre.', pedirDato()), { motivo: 'FALTA_CLIENTE' })
  }
  const clientId = clienteActual.id

  /* ───────────────────────────── RESERVAR ───────────────────────────── */

  if (intencion === 'RESERVAR' || intencion === 'MOVER') {
    const holdId = String(decision.holdId ?? '').trim()
    if (!holdId) return responder('¿Cuál de los horarios que te ofrecí prefieres?', { motivo: 'FALTA_APARTADO' })

    // El apartado tiene que existir, ser de este negocio y seguir vivo. Es lo que hace
    // imposible reservar un horario que no se ofreció en un turno anterior.
    const { data: hold } = await db.from('appointment_holds')
      .select('id,service_id,professional_id,period,expires_at,service:services(name),professional:professionals(display_name)')
      .eq('id', holdId).eq('business_id', body.businessId).maybeSingle()
    if (!hold || new Date(hold.expires_at).getTime() <= Date.now()) {
      return responder(TEXTO_CUPO_OCUPADO, { motivo: 'CUPO_OCUPADO' })
    }

    const { data: servicio } = await db.from('services')
      .select('name,buffer_before_minutes').eq('id', hold.service_id).eq('business_id', body.businessId).maybeSingle()
    const { data: profesional } = await db.from('professionals')
      .select('display_name').eq('id', hold.professional_id).eq('business_id', body.businessId).maybeSingle()

    // `period` incluye el buffer previo; el inicio visible del servicio es lo que ve el cliente.
    const inicioOcupado = rangoInicio(hold.period)
    const inicioServicio = new Date(new Date(inicioOcupado).getTime() + Number(servicio?.buffer_before_minutes ?? 0) * 60000).toISOString()

    if (intencion === 'MOVER') {
      const appointmentId = String(decision.appointmentId ?? '').trim()
      const { reserva } = await findClientAppointment(db, { businessId: body.businessId, clientId, appointmentId })
      if (!appointmentId || !reserva) {
        return responder('¿Cuál de tus horas quieres cambiar?', { motivo: 'FALTA_RESERVA' })
      }
      // El apartado bloquea el propio horario al que se quiere mover: se suelta antes.
      await db.from('appointment_holds').delete().eq('id', holdId).eq('business_id', body.businessId)
      const { data, error } = await db.rpc('reschedule_safe_appointment', {
        p_appointment_id: reserva.id,
        p_new_start: inicioServicio,
        p_reason: String(decision.reason ?? '').trim().slice(0, 300) || 'El cliente pidió cambiar la hora',
        p_actor: clienteActual.full_name || 'El cliente',
      })
      if (error) {
        const motivo = motivoDeError(error)
        registrarAviso('agente_act_mover_fallo', { businessId: body.businessId, motivo })
        return responder(motivo === 'CUPO_OCUPADO' ? TEXTO_CUPO_OCUPADO : TEXTO_NO_SE_PUDO, { motivo })
      }
      const movida = data as unknown as ReservaDelCliente | null
      return NextResponse.json({
        ejecutado: true, motivo: 'OK', accion: 'MOVER',
        text: conPeticionDeDato(textoReservaMovida({
          start: movida ? rangoInicio(movida.service_period) : inicioServicio,
          serviceName: servicio?.name ?? null,
          professionalName: profesional?.display_name ?? null,
          timezone,
        }), pedirDato()),
      })
    }

    const resultado = await reservarConApartado(db, {
      businessId: body.businessId,
      clientId,
      professionalId: String(hold.professional_id),
      serviceId: String(hold.service_id),
      desiredStart: inicioServicio,
      holdId,
      contactKey: phone,
      timezone,
    })
    if (!resultado.ok) {
      registrarAviso('agente_act_reservar_fallo', { businessId: body.businessId, motivo: resultado.motivo })
      return responder(resultado.motivo === 'CUPO_OCUPADO' ? TEXTO_CUPO_OCUPADO : TEXTO_NO_SE_PUDO, { motivo: resultado.motivo })
    }

    const guardada = resultado.appointment as Record<string, unknown>
    return NextResponse.json({
      ejecutado: true, motivo: 'OK', accion: 'RESERVAR',
      text: conPeticionDeDato(textoReservaHecha({
        start: rangoInicio(guardada.service_period) || inicioServicio,
        serviceName: servicio?.name ?? null,
        professionalName: profesional?.display_name ?? null,
        timezone,
      }), pedirDato()),
    })
  }

  /* ─────────────────────── CANCELAR y CONFIRMAR ─────────────────────── */

  const { data: vigentes } = await listClientAppointments(db, { businessId: body.businessId, clientId })
  const reservas = ((vigentes ?? []) as unknown as ReservaDelCliente[])
  if (!reservas.length) return responder(TEXTO_SIN_RESERVAS, { motivo: 'SIN_RESERVAS' })

  const pedido = String(decision.appointmentId ?? '').trim()
  const elegida = reservas.find((reserva) => reserva.id === pedido)
    ?? (reservas.length === 1 ? reservas[0] : null)

  if (!elegida) {
    return responder(textoVariasReservas(reservas.map((reserva) => ({
      date: formatInZone(rangoInicio(reserva.service_period), timezone, { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', ''),
      time: formatTimeInZone(rangoInicio(reserva.service_period), timezone),
      serviceName: reserva.service?.name ?? null,
    }))), { motivo: 'VARIAS_RESERVAS' })
  }

  const datosTexto = {
    start: rangoInicio(elegida.service_period),
    serviceName: elegida.service?.name ?? null,
    professionalName: elegida.professional?.display_name ?? null,
    timezone,
  }

  if (intencion === 'CONFIRMAR') {
    const resultado = await confirmClientAppointment(db, elegida)
    if (!resultado.ok) return responder(TEXTO_NO_SE_PUDO, { motivo: 'NO_VIGENTE' })
    return NextResponse.json({
      ejecutado: true, motivo: 'OK', accion: 'CONFIRMAR',
      text: conPeticionDeDato(resultado.yaEstaba ? textoYaEstabaConfirmada(datosTexto) : textoReservaConfirmada(datosTexto), pedirDato()),
    })
  }

  const resultado = await releaseClientAppointment(db, elegida, String(decision.reason ?? '').trim().slice(0, 300) || 'El cliente avisó que no podía asistir')
  if (!resultado.ok) return responder(TEXTO_NO_SE_PUDO, { motivo: 'NO_VIGENTE' })
  return NextResponse.json({
    ejecutado: true, motivo: 'OK', accion: 'CANCELAR',
    text: resultado.yaEstaba ? textoYaEstabaCancelada(datosTexto) : textoReservaCancelada(datosTexto),
  })
}
