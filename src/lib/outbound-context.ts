import type { SupabaseClient } from '@supabase/supabase-js'
import type { EsperaDelAviso } from '@/lib/notification-templates'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'

/**
 * Memoria de lo que AGEN le manda al cliente por su cuenta.
 *
 * El fallo que resuelve, visto en producción: un recordatorio automático decía «Responde Sí
 * para confirmar que vienes. Si no puedes, responde NO…», el cliente escribió «No» y el agente
 * contestó «¿A qué te refieres con "no"?». La respuesta llegaba sin la pregunta: la cola de
 * avisos se procesa y se olvida, y el agente solo veía la palabra suelta.
 *
 * No es el problema de un recordatorio: le pasa a cualquier mensaje saliente que pueda recibir
 * respuesta. Por eso el registro es uno solo, se escribe **después de una entrega exitosa** —lo
 * que no llegó no puede ser contestado— y lo leen todos los turnos del agente.
 *
 * Diseño: nada de esto puede tumbar un envío ni un turno. Si la tabla todavía no existe (la app
 * puede desplegarse antes que la migración, CLAUDE.md §5.7) o la escritura falla, el aviso sale
 * igual y el agente sigue trabajando como antes. Perder contexto degrada la conversación;
 * perder el mensaje sería mucho peor.
 */

const TABLA_AUSENTE = '42P01'

export type TipoDeAvisoSaliente =
  | 'BOOKED' | 'CHANGED' | 'CONFIRM_REQUEST' | 'DAY_OF_REMINDER'
  | 'REMINDER_24H' | 'REMINDER_2H' | 'RESCHEDULED' | 'CANCELLED'
  | 'WAITLIST_SLOT' | 'FOLLOW_UP' | 'REVIEW_REQUEST' | 'CAMPAIGN'

export type AvisoSaliente = {
  businessId: string
  clientId: string
  channel: 'WHATSAPP' | 'EMAIL'
  kind: string
  espera: EsperaDelAviso
  appointmentId?: string | null
  campaignId?: string | null
  /** Por qué se envió y sobre qué: el motivo del cambio, la hora anterior, el servicio… */
  summary?: string | null
  payload?: Record<string, unknown>
  /** Tope de vigencia externo: un recordatorio no sobrevive a la hora de la que habla. */
  noMasAllaDe?: string | null
}

/** Contexto de la campaña de marketing, que no pasa por las plantillas de avisos. */
export const ESPERA_DE_CAMPANA: EsperaDelAviso = {
  expects: 'FREE',
  question: 'Le mandamos una campaña de marketing del negocio (una promoción o novedad). No le pedimos que confirme nada.',
  ttlHours: 72,
  ifYes: 'Le interesa la promoción: respóndele sobre ella y, si quiere reservar, sigue el camino normal. NO es una confirmación de reserva.',
  ifNo: 'No le interesa: una línea amable, no insistas y no vuelvas a mencionarla.',
}

function vigenciaHasta(espera: EsperaDelAviso, noMasAllaDe?: string | null) {
  const porTiempo = Date.now() + espera.ttlHours * 3600_000
  const tope = noMasAllaDe ? new Date(noMasAllaDe).getTime() : NaN
  const limite = Number.isFinite(tope) ? Math.min(porTiempo, tope) : porTiempo
  // Un tope ya pasado dejaría el aviso muerto al nacer: siempre queda una ventana mínima para
  // que la respuesta del cliente encuentre su pregunta.
  return new Date(Math.max(limite, Date.now() + 30 * 60_000)).toISOString()
}

/**
 * Deja registrado un mensaje automático que ya salió. Nunca lanza: devuelve si se pudo o no.
 */
export async function registrarAvisoSaliente(db: SupabaseClient, aviso: AvisoSaliente): Promise<boolean> {
  if (aviso.espera.expects === 'NONE') return false
  try {
    const { error } = await db.from('outbound_prompts').insert({
      business_id: aviso.businessId,
      client_id: aviso.clientId,
      channel: aviso.channel,
      kind: aviso.kind,
      appointment_id: aviso.appointmentId ?? null,
      campaign_id: aviso.campaignId ?? null,
      expects: aviso.espera.expects,
      question: aviso.espera.question,
      if_yes: aviso.espera.ifYes ?? null,
      if_no: aviso.espera.ifNo ?? null,
      summary: aviso.summary ?? null,
      payload: aviso.payload ?? {},
      // Explícito y no por defecto de la base: el instante que cuenta es el del envío, y es el
      // mismo con el que se compara «cuántos mensajes escribió desde entonces».
      sent_at: new Date().toISOString(),
      expires_at: vigenciaHasta(aviso.espera, aviso.noMasAllaDe),
    })
    if (error && error.code !== TABLA_AUSENTE) {
      console.error('[outbound-prompts] no se pudo registrar el aviso', { kind: aviso.kind, code: error.code })
    }
    return !error
  } catch {
    return false
  }
}

export type AvisoPendiente = {
  kind: string
  expects: string
  /** Qué se le preguntó, en una línea. */
  question: string
  /** Qué hacer si contesta que sí, y qué si contesta que no. */
  ifYes: string | null
  ifNo: string | null
  /** Por qué se envió y sobre qué. */
  summary: string | null
  sentAt: string
  /** "hace 20 minutos", "hace 3 horas", "ayer": para que el modelo sepa si sigue caliente. */
  sentAgo: string
  appointmentId: string | null
  campaignId: string | null
  /**
   * Cuántos mensajes ha escrito el cliente desde que salió el aviso, contando el actual.
   * 1 = está contestando esto ahora mismo. Más = la conversación ya siguió, así que el aviso
   * es antecedente y no la pregunta que tiene delante.
   */
  repliesSince: number
  appointment?: { date: string; time: string; serviceName: string | null; professionalName: string | null } | null
}

function haceCuanto(desde: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000))
  if (minutos < 2) return 'recién'
  if (minutos < 60) return `hace ${minutos} minutos`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`
  const dias = Math.round(horas / 24)
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * El último mensaje automático que sigue esperando respuesta de esta persona.
 *
 * Se pide junto al resto del contexto del turno (`cargarContexto`), no en una llamada aparte:
 * el agente ya iba justo de tiempo y esto tiene que ser gratis.
 */
export async function cargarAvisoPendiente(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string; phone: string; timezone: string },
): Promise<AvisoPendiente | null> {
  const { data, error } = await db.from('outbound_prompts')
    .select('kind,expects,question,if_yes,if_no,summary,sent_at,appointment_id,campaign_id')
    .eq('business_id', datos.businessId)
    .eq('client_id', datos.clientId)
    .is('answered_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null

  const fila = data as {
    kind: string; expects: string; question: string; summary: string | null
    if_yes: string | null; if_no: string | null
    sent_at: string; appointment_id: string | null; campaign_id: string | null
  }

  // Dos datos que dependen de la fila y son independientes entre sí.
  const [mensajes, cita] = await Promise.all([
    db.from('agent_inbox').select('id', { count: 'exact', head: true })
      .eq('business_id', datos.businessId).eq('phone', datos.phone).gte('created_at', fila.sent_at),
    fila.appointment_id
      ? db.from('appointments')
        .select('service_period,professional:professionals(display_name),service:services(name)')
        .eq('id', fila.appointment_id).maybeSingle()
      : Promise.resolve({ data: null } as { data: null }),
  ])

  const periodo = cita.data ? String((cita.data as { service_period?: unknown }).service_period ?? '').replace(/[[\]()"]/g, '').split(',')[0] : ''
  const detalle = cita.data && periodo
    ? {
      date: formatInZone(periodo, datos.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
      time: formatTimeInZone(periodo, datos.timezone),
      serviceName: ((cita.data as { service?: { name?: string } }).service?.name) ?? null,
      professionalName: ((cita.data as { professional?: { display_name?: string } }).professional?.display_name) ?? null,
    }
    : null

  return {
    kind: fila.kind,
    expects: fila.expects,
    question: fila.question,
    ifYes: fila.if_yes,
    ifNo: fila.if_no,
    summary: fila.summary,
    sentAt: fila.sent_at,
    sentAgo: haceCuanto(fila.sent_at),
    appointmentId: fila.appointment_id,
    campaignId: fila.campaign_id,
    repliesSince: Math.max(1, mensajes.count ?? 1),
    appointment: detalle,
  }
}
