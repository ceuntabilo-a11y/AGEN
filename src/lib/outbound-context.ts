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
  | 'REMINDER' | 'REMINDER_24H' | 'REMINDER_2H' | 'RESCHEDULED' | 'CANCELLED'
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

/** Un saludo a secas nunca contesta a nada. */
const SALUDO_SOLO = /^[\s¡]*(hola+|buenas?|buenos d[ií]as|buenas tardes|buenas noches|hey|holi|qu[eé] tal|saludos)[\s!¡.,:;)?😊🙂😀👋]*$/i

/*
 * Ojo con `\b` y los acentos: en JS `í` no es carácter de palabra, así que `/\bsí\b/` NUNCA casa
 * con «sí» (la misma trampa que ya documenta `@/lib/agent-reply`). Por eso los límites se
 * escriben a mano con lookarounds sobre el alfabeto español.
 */
const ANTES = '(?<![a-zA-Z0-9áéíóúüñ])'
const DESPUES = '(?![a-zA-Z0-9áéíóúüñ])'
const palabras = (alternativas: string) => new RegExp(`${ANTES}(?:${alternativas})${DESPUES}`, 'i')

/** Formas en las que una persona contesta que sí, que no o que ahora no. */
const RESPUESTA_SUELTA = [
  palabras('s[ií]|sip|claro|dale|ok|okey|okay|listo|perfecto|bueno|de acuerdo|acepto|confirmo|confirmado|asisto|voy|ah[ií] estar[eé]|me sirve|me acomoda|quiero'),
  palabras('no|nop|nel|imposible|no puedo|no podr[eé]|no voy|no ir[eé]|cancel(?:a|o|ar|ame|en|arla)?|an[uú]la(?:r|me)?|liberar?|no me sirve|no me acomoda'),
  palabras('despu[eé]s|m[aá]s tarde|luego|otro d[ií]a|lo pienso|todav[ií]a no|a[uú]n no'),
]

/** Palabras que dicen que el mensaje habla de lo mismo que el aviso. */
const SOBRE_EL_TEMA = palabras('hora|horas|horario|horarios|cita|reserva|reservar|agenda|agendar|cambiar|c[aá]mbia\\w*|mover|reagendar|reprogramar|confirmar|cancelar|promoci[oó]n|oferta')

/** Una calificación del 1 al 5, que es lo que espera una encuesta. */
const CALIFICACION = /(^\s*[1-5]\s*$)|\b[1-5]\s*(\/|de)\s*5\b/

/** Un mensaje largo ya no es "una respuesta suelta": tiene que hablar del tema para contar. */
const LARGO_DE_UNA_RESPUESTA = 120

/**
 * ¿Este mensaje puede estar contestando al aviso?
 *
 * Existe por un fallo real: había un seguimiento pendiente («hace tiempo que no vienes,
 * ¿te busco hora?»), el cliente escribió **«Hola»** y el agente le contestó al seguimiento en vez
 * de saludar. El aviso se le entregaba en todos los turnos mientras siguiera vivo, así que
 * cualquier mensaje —incluido un saludo— parecía tener esa pregunta delante.
 *
 * La decisión se toma acá, en la app, y no en el prompt: es determinista, se puede probar, y
 * además ahorra la consulta en la mayoría de los turnos.
 */
export function pareceRespuestaAlAviso(mensaje: string | null | undefined): boolean {
  const texto = String(mensaje ?? '').trim()
  if (!texto) return false
  if (SALUDO_SOLO.test(texto)) return false
  // Una nota suelta del 1 al 5 solo puede ser la respuesta a una encuesta.
  if (CALIFICACION.test(texto)) return true
  if (SOBRE_EL_TEMA.test(texto)) return true
  if (texto.length > LARGO_DE_UNA_RESPUESTA) return false
  return RESPUESTA_SUELTA.some((patron) => patron.test(texto))
}

/**
 * El último mensaje automático que sigue esperando respuesta de esta persona, **y solo si el
 * mensaje que acaba de llegar puede estar contestándolo**.
 *
 * Se pide junto al resto del contexto del turno (`cargarContexto`), no en una llamada aparte:
 * el agente ya iba justo de tiempo y esto tiene que ser gratis.
 */
export async function cargarAvisoPendiente(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string; phone: string; timezone: string; message?: string | null },
): Promise<AvisoPendiente | null> {
  /*
   * Sin mensaje no se entrega el aviso.
   *
   * Es deliberado: si el workflow todavía no manda el texto del cliente (despliegue a medias),
   * la conducta vuelve a ser la de antes de existir esta función, que es la segura. Entregar el
   * aviso "por si acaso" es justo lo que hizo que un «Hola» disparara un seguimiento.
   */
  if (!pareceRespuestaAlAviso(datos.message)) return null

  const { data, error } = await db.from('outbound_prompts')
    .select('id,kind,expects,question,if_yes,if_no,summary,sent_at,appointment_id,campaign_id')
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

  /*
   * El aviso se entrega UNA vez y queda cerrado.
   *
   * Fallo real: quedó vivo un aviso de cancelación y, tres mensajes después, un «sí por favor»
   * —que contestaba a la última pregunta del agente— se leyó contra ese aviso viejo. El agente
   * repitió «ese horario ya no está disponible» y la conversación entró en bucle.
   *
   * Si el cliente escribió algo que puede ser su respuesta, esa ES su respuesta: a partir de
   * ahí manda la conversación en curso, no un mensaje automático de hace horas.
   */
  await db.from('outbound_prompts')
    .update({ answered_at: new Date().toISOString(), resolution: 'ANSWERED', answer: String(datos.message ?? '').slice(0, 500) })
    .eq('id', (data as { id?: string }).id ?? '')

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
