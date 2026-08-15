import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { buildNotification } from '@/lib/notification-templates'
import { sendWhatsApp } from '@/lib/whatsapp'
import { sendMarketingEmail } from '@/lib/resend'
import { claimNotifications, contarAvisosAmbiguos, descartarAviso, marcarAvisoEnviado, reintentarAviso, type AvisoReclamado } from '@/lib/notification-dispatch'
import { registrarAvisoSaliente } from '@/lib/outbound-context'

/**
 * Envía de verdad los avisos pendientes de la cola.
 *
 * Antes esta cola se entregaba a un "gateway" externo que nunca existió, así que ningún
 * cliente recibía nada. Ahora la propia app arma el texto y lo manda por el WhatsApp del
 * negocio (Evolution/Meta/360dialog) o por correo (Resend). n8n solo dispara este endpoint.
 */

export const dynamic = 'force-dynamic'

type OutboxRow = {
  id: number
  business_id: string
  appointment_id: string | null
  client_id: string
  event_type: string
  channel: string
  payload: Record<string, unknown> | null
}

const BUSINESS_FIELDS = 'id,name,address,maps_url,timezone,email,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key'

/** El texto de WhatsApp (con *negrita*) reutilizado como correo simple y legible. */
function textToHtml(text: string) {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1c1b22;max-width:520px">${escaped}</div>`
}

/** Avisos que dejan de tener sentido una vez que la hora de la que hablan ya pasó. */
const RECORDATORIOS = ['CONFIRM_REQUEST', 'DAY_OF_REMINDER', 'REMINDER_24H', 'REMINDER_2H']

/**
 * Tipo con el que se guarda el aviso para el agente.
 *
 * `CHANGED` cubre cuatro cosas que piden respuestas opuestas: una cancelación (un "sí" quiere
 * decir «búscame otro horario»), un cambio de hora o de profesional (un "sí" confirma la hora
 * nueva) y un cambio de duración. Guardarlas con el mismo nombre obligaría al agente a
 * adivinar, que es justo el fallo que esto viene a cerrar.
 */
function tipoDeAviso(eventType: string, payload: Record<string, unknown>) {
  if (eventType !== 'CHANGED') return eventType
  const kind = typeof payload.kind === 'string' ? payload.kind : 'RESCHEDULE'
  return `CHANGED_${kind}`
}

/** Por qué se le escribió, en las mismas palabras que vio el cliente. */
function resumirAviso(eventType: string, payload: Record<string, unknown>) {
  const partes: string[] = []
  const kind = typeof payload.kind === 'string' ? payload.kind : null
  if (eventType === 'CHANGED' && kind) {
    partes.push({ CANCEL: 'cancelación', RESCHEDULE: 'cambio de hora', MOVE: 'cambio de hora o profesional', RESIZE: 'cambio de duración' }[kind] ?? kind)
  }
  if (typeof payload.reason === 'string' && payload.reason.trim()) partes.push(`motivo: ${payload.reason.trim()}`)
  if (typeof payload.actor === 'string' && payload.actor.trim()) partes.push(`lo hizo: ${payload.actor.trim()}`)
  return partes.length ? partes.join(' · ').slice(0, 400) : null
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const db = createAdminClient()

  // Reclamar consume el intento: la fila queda procesada antes de intentar el envío, así un
  // envío exitoso cuya escritura de cierre falle no se repite (ver @/lib/notification-dispatch).
  const { avisos, error: claimError } = await claimNotifications(db, 50)
  if (claimError) return NextResponse.json({ error: 'No se pudo reclamar la cola' }, { status: 500 })
  const rows = avisos as unknown as OutboxRow[]
  if (!rows.length) return NextResponse.json({ sent: 0, skipped: 0, failed: 0 })

  const businessIds = Array.from(new Set(rows.map((row) => row.business_id)))
  const clientIds = Array.from(new Set(rows.map((row) => row.client_id)))
  const appointmentIds = Array.from(new Set(rows.map((row) => row.appointment_id).filter((id): id is string => Boolean(id))))

  const [businesses, clients, appointments] = await Promise.all([
    db.from('businesses').select(BUSINESS_FIELDS).in('id', businessIds),
    db.from('clients').select('id,full_name,phone,email').in('id', clientIds),
    appointmentIds.length
      ? db.from('appointments').select('id,status,service_period,client_confirmed_at,professional:professionals(display_name),service:services(name)').in('id', appointmentIds)
      : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
  ])
  if (businesses.error || clients.error || appointments.error) {
    return NextResponse.json({ error: 'No se pudo cargar el detalle de los avisos' }, { status: 500 })
  }

  const businessById = new Map((businesses.data ?? []).map((item: any) => [item.id, item]))
  const clientById = new Map((clients.data ?? []).map((item: any) => [item.id, item]))
  const appointmentById = new Map((appointments.data as any[] ?? []).map((item: any) => [item.id, item]))

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const business = businessById.get(row.business_id)
    const client = clientById.get(row.client_id)
    const appointment = row.appointment_id ? appointmentById.get(row.appointment_id) : null

    const discard = async (reason: string) => {
      skipped += 1
      await descartarAviso(db, row as unknown as AvisoReclamado, reason)
    }

    if (!business || !client) { await discard('sin_negocio_o_cliente'); continue }

    // Una cita cancelada no manda recordatorios, y quien ya confirmó no recibe el de la mañana.
    if (appointment) {
      const scheduled = ['CONFIRM_REQUEST', 'DAY_OF_REMINDER', 'REMINDER_24H', 'REMINDER_2H'].includes(row.event_type)
      if (scheduled && !['PENDING', 'CONFIRMED'].includes(appointment.status)) { await discard('cita_no_vigente'); continue }
      if (scheduled && appointment.client_confirmed_at) { await discard('ya_confirmada'); continue }
    }

    const start = appointment?.service_period ? String(appointment.service_period).replace(/[[\]()"]/g, '').split(',')[0] : null
    const end = appointment?.service_period ? String(appointment.service_period).replace(/[[\]()"]/g, '').split(',')[1] : null

    const message = buildNotification(row.event_type, {
      business: { name: business.name, address: business.address, maps_url: business.maps_url, timezone: business.timezone },
      clientName: client.full_name,
      appointment: start
        ? { start, end, serviceName: appointment?.service?.name ?? null, professionalName: appointment?.professional?.display_name ?? null }
        : null,
      payload: row.payload ?? {},
    })
    if (!message) { await discard('sin_plantilla'); continue }

    let result: { success: boolean; error?: string }
    if (row.channel === 'WHATSAPP') {
      result = client.phone
        ? await sendWhatsApp(business, { phone: client.phone, text: message.text })
        : { success: false, error: 'cliente_sin_telefono' }
    } else if (row.channel === 'EMAIL') {
      result = client.email
        ? await sendMarketingEmail({ to: client.email, subject: message.subject, html: textToHtml(message.text), businessName: business.name, replyTo: business.email })
        : { success: false, error: 'cliente_sin_correo' }
    } else {
      result = { success: false, error: `canal_no_soportado_${row.channel}` }
    }

    if (result.success) {
      sent += 1
      await marcarAvisoEnviado(db, row.id)
      // El aviso llegó: queda registrado qué se preguntó, sobre qué y hasta cuándo, para que
      // el agente pueda leer el "sí" o el "no" que venga después. Nunca bloquea el envío.
      await registrarAvisoSaliente(db, {
        businessId: row.business_id,
        clientId: row.client_id,
        channel: row.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP',
        // `CHANGED` a secas no dice nada: cancelar, mover y alargar piden respuestas distintas.
        kind: tipoDeAviso(row.event_type, row.payload ?? {}),
        espera: message.espera,
        appointmentId: row.appointment_id,
        summary: resumirAviso(row.event_type, row.payload ?? {}),
        payload: row.payload ?? {},
        // Un recordatorio no sobrevive a la hora de la que habla: pasada la cita, un "sí"
        // suelto ya no es una confirmación de asistencia.
        noMasAllaDe: RECORDATORIOS.includes(row.event_type) ? (end ?? start) : null,
      })
    } else {
      failed += 1
      await reintentarAviso(db, row as unknown as AvisoReclamado, result.error ?? 'error_desconocido')
    }
  }

  // Avisos que quedaron con la marca de entrega en vuelo: no se sabe si salieron. No se
  // reenvían solos (duplicaría), pero se informan para que el fallo no quede invisible.
  const ambiguos = await contarAvisosAmbiguos(db, new Date(Date.now() - 15 * 60000))
  return NextResponse.json({ sent, skipped, failed, ambiguous: ambiguos })
}
