import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Revisión de lo que el modelo quiere mandarle al cliente (A5).
 *
 * El prompt pide muchas cosas, pero no las garantiza: un modelo puede inventar que reservó,
 * pegar el resultado crudo de una tool, filtrar un id interno o devolver algo vacío. Esta capa
 * corre en la app, antes del envío, y no depende de la buena conducta del modelo.
 *
 * Dos niveles:
 * - Limpieza: se quita lo que no aporta y no debería verse (ids internos, markdown técnico).
 * - Bloqueo: si el texto está corrupto, filtra información interna o AFIRMA una acción que la
 *   base de datos no respalda, no se envía nada de eso: sale una respuesta de respaldo honesta.
 */

export const RESPUESTA_DE_RESPALDO =
  'Disculpa, tuve un problema y no pude completar eso. ¿Quieres que lo intente de nuevo?'

/**
 * Respaldos para cuando el texto no sirve pero la acción SÍ se hizo.
 *
 * Pasó en producción: el cliente pidió cancelar, la hora se canceló de verdad en la base, y el
 * texto del modelo salió con su propio razonamiento dentro. La revisión lo bloqueó —bien— y le
 * mandó al cliente "no pude completar eso" —mal—: la hora estaba cancelada. Decirle que algo
 * falló cuando sí ocurrió es tan dañino como lo contrario, y encima le hace insistir.
 *
 * Con la evidencia de la base ya se sabe qué pasó, así que el respaldo puede ser verdad.
 */
export const RESPALDO_SEGUN_ACCION: Record<'reservo' | 'confirmo' | 'cancelo', string> = {
  reservo: 'Listo, tu hora quedó reservada. Si necesitas cambiarla, dime.',
  confirmo: 'Listo, tu hora quedó confirmada. Te esperamos.',
  cancelo: 'Listo, cancelé tu hora. ¿Quieres que te busque otro horario?',
}

/** Tope de un mensaje de WhatsApp del agente. Más largo que esto no es una respuesta, es un volcado. */
const LARGO_MAXIMO = 1200
const LARGO_MINIMO = 2

export type MotivoRevision =
  | 'id_interno' | 'markdown_tecnico'
  | 'vacia' | 'datos_crudos' | 'error_tecnico' | 'interno_del_sistema'
  | 'razonamiento_del_modelo' | 'idioma_incorrecto'
  | 'reserva_sin_evidencia' | 'cancelacion_sin_evidencia' | 'confirmacion_sin_evidencia'

export type EvidenciaDelTurno = {
  reservo: boolean
  cancelo: boolean
  confirmo: boolean
  /**
   * La última de las tres que ocurrió, por marca de tiempo. Sin esto no se puede elegir el
   * respaldo correcto cuando en el mismo turno hubo más de una (reservar y luego cancelar).
   */
  ultima?: 'reservo' | 'confirmo' | 'cancelo' | null
}
export type RevisionRespuesta = { texto: string; bloqueada: boolean; motivos: MotivoRevision[] }

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/** Señales de que el texto es un volcado técnico y no una respuesta para una persona. */
const SENALES_CRUDAS = [
  /\{\s*"[^"]+"\s*:/,                          // JSON crudo
  /"(status|statusCode|error|body|code)"\s*:/i,
  /\b(status|statusCode)\s*[:=]\s*\d{3}\b/i,
  /\bHTTP\s*[45]\d{2}\b/i,
  /\b[45]\d{2}\s+(Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error)\b/i,
]
const SENALES_DE_ERROR = [
  /\b(TypeError|ReferenceError|SyntaxError|Traceback|ECONNREFUSED|ETIMEDOUT|NetworkError)\b/,
  /\berror\s*[:=]/i,
  /\bstack\b.*\bat\s+\w+/i,
  /\b(undefined|NaN)\b/,
  /\b(23P01|23505|42501|P0001|P0002|PGRST\d+)\b/,
]
const SENALES_INTERNAS = [
  /\b(holdId|appointmentId|businessId|clientId|professionalId|serviceId|messageId)\b/i,
  /\bx-agen-secret\b/i,
  /\/api\/(agent|admin|automation|platform)\//i,
  /\b(supabase|postgrest|service[_ ]role|n8n|webhook|evolution api|openai)\b/i,
]

/**
 * El modelo pensando en voz alta.
 *
 * Pasó de verdad: ante un "Ok" suelto, el agente le mandó al cliente su propio razonamiento
 * —en inglés, citando sus reglas y sus herramientas por nombre— en vez de una respuesta.
 * El prompt lo prohíbe, pero el prompt no lo garantiza; esta capa sí, porque corre en la app.
 *
 * Los nombres de las herramientas van aparte de `SENALES_INTERNAS` porque son inofensivos
 * como palabras y demoledores como filtración: si aparece "buscar_horarios" en un mensaje de
 * WhatsApp, no es una respuesta, es el andamio.
 */
const NOMBRES_DE_HERRAMIENTAS = /\b(buscar_horarios|crear_reserva|registrar_cliente|guardar_memoria|mis_reservas|confirmar_reserva|liberar_reserva|avisar_al_equipo)\b/i

const SENALES_DE_RAZONAMIENTO = [
  NOMBRES_DE_HERRAMIENTAS,
  /\b(we|i)\s+(must|should|need to|have to|can|cannot|will|are|were)\b/i,
  /\b(the user|the assistant|the platform|the system prompt|per rule|rule \d+|tool call|function call)\b/i,
  /\b(let'?s|okay,? so|first,? we|next,? we|clarify:)/i,
  /\bregla\s*\d+\b/i,
  /\bREGLA DE SALIDA\b/,
  // Las etiquetas del contexto que se le inyecta: si salen, salió el andamio entero.
  /(^|\n)\s*(MENSAJE|NEGOCIO|ACTOR|FICHA|CLIENTE|SERVICIOS|RESERVAS|TIEMPO|ZONA|EQUIPO|AGENDA_HOY):/,
]

/** Palabras funcionales: sirven para saber en qué idioma está escrito, no de qué habla. */
const PALABRAS_ES = /\b(que|de|la|el|los|las|para|con|una|uno|tu|te|es|está|hora|día|puedo|quieres|gracias|hola)\b/gi
const PALABRAS_EN = /\b(the|and|we|should|must|would|because|there|about|which|user|assistant|response|however|need)\b/gi

/**
 * Texto escrito en inglés donde solo puede haber español.
 *
 * Conservador a propósito: hace falta que el inglés domine con claridad. Una respuesta normal
 * puede llevar una palabra suelta en inglés (un nombre de servicio, "spa", "look") y eso no
 * puede bloquear un mensaje legítimo.
 */
export function pareceOtroIdioma(texto: string): boolean {
  const es = (texto.match(PALABRAS_ES) ?? []).length
  const en = (texto.match(PALABRAS_EN) ?? []).length
  return en >= 4 && en > es * 2
}

export function pareceRazonamiento(texto: string): boolean {
  return SENALES_DE_RAZONAMIENTO.some((patron) => patron.test(texto))
}

/** Frases que dan una acción por hecha. Se evalúan por oración, no sobre el texto entero. */
const AFIRMA_RESERVA = [
  /\bqued(ó|o|aste|é|as)\s+(agendad|reservad)/i,
  // Ojo: `\b` no cierra palabra después de una vocal acentuada (no es carácter de palabra en
  // JS), así que "cancelé" nunca casaría con /cancel(é)\b/. Se usa un lookahead explícito.
  /\b(te\s+)?(agend(é|e|amos)|reserv(é|e|amos))(?![a-záéíóúñ])/i,
  /\bte\s+(dej[éeo]|dejamos)\s+(agendad|reservad|list)/i,
  /\b(tu|la)\s+(reserva|hora|cita)\s+(ya\s+)?(quedó|está|estás?)\s+(hecha|lista|registrada|agendada|tomada)\b/i,
  /\b(list[oa]|perfecto)[,.!]?\s+(ya\s+)?(est(á|as)|qued(ó|as))\s+(agendad|reservad)/i,
]
const AFIRMA_CANCELACION = [
  /\b(cancel(é|e|amos)|liber(é|e|amos)|solt(é|e|amos))(?![a-záéíóúñ])/i,
  /\b(tu|la)\s+(reserva|hora|cita)\s+(ya\s+)?(quedó|está|fue)\s+(cancelada|liberada|anulada)\b/i,
]
const AFIRMA_CONFIRMACION = [
  /\bconfirm(é|e|amos)\s+(tu|la)\s+(reserva|hora|cita)\b/i,
  /\b(tu|la)\s+(reserva|hora|cita)\s+(ya\s+)?(quedó|está|estás?)\s+confirmada\b/i,
  /\bqued(ó|o)\s+confirmada\b/i,
]

/**
 * Una oración que pregunta u ofrece no afirma nada: "¿Te agendo el lunes?" no es una reserva.
 * El filtro es estrecho a propósito: si fuera amplio, dejaría pasar afirmaciones falsas.
 */
function esPreguntaOOferta(oracion: string) {
  return /[¿?]/.test(oracion)
    || /\bsi\s+(quieres|prefieres|te\s+acomoda)/i.test(oracion)
    || /\b(puedo|podría|podemos|quieres\s+que|te\s+parece)\b/i.test(oracion)
}

function oraciones(texto: string) {
  return texto.split(/(?<=[.!?¿¡\n])\s+|\n+/).map((item) => item.trim()).filter(Boolean)
}

function afirma(texto: string, patrones: RegExp[]) {
  return oraciones(texto).some((oracion) => !esPreguntaOOferta(oracion) && patrones.some((patron) => patron.test(oracion)))
}

export function detectarAfirmaciones(texto: string) {
  return {
    reservo: afirma(texto, AFIRMA_RESERVA),
    cancelo: afirma(texto, AFIRMA_CANCELACION),
    confirmo: afirma(texto, AFIRMA_CONFIRMACION),
  }
}

/** Quita lo que sobra sin cambiar el sentido. Lo grave no se limpia: se bloquea más abajo. */
export function sanitizarRespuesta(texto: string): { texto: string; motivos: MotivoRevision[] } {
  const motivos: MotivoRevision[] = []
  let limpio = String(texto ?? '')

  if (/```|`{1,2}[^`]+`{1,2}/.test(limpio)) {
    limpio = limpio.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1')
    motivos.push('markdown_tecnico')
  }
  if (UUID.test(limpio)) {
    limpio = limpio.replace(UUID, '')
    motivos.push('id_interno')
  }
  UUID.lastIndex = 0

  limpio = limpio.replace(/[ \t]{2,}/g, ' ').replace(/\(\s*(ref\.?|id)?\s*\)/gi, '').replace(/\n{3,}/g, '\n\n').trim()
  if (limpio.length > LARGO_MAXIMO) limpio = `${limpio.slice(0, LARGO_MAXIMO - 1).trimEnd()}…`
  return { texto: limpio, motivos }
}

/**
 * Decide qué se envía. Devuelve el texto listo para WhatsApp: el del modelo si pasa la
 * revisión, o la respuesta de respaldo si no. Nunca devuelve algo vacío.
 */
export function revisarRespuesta(original: string, evidencia: EvidenciaDelTurno): RevisionRespuesta {
  const { texto, motivos } = sanitizarRespuesta(original)
  const graves: MotivoRevision[] = []

  if (texto.length < LARGO_MINIMO) graves.push('vacia')
  if (SENALES_CRUDAS.some((patron) => patron.test(texto))) graves.push('datos_crudos')
  if (SENALES_DE_ERROR.some((patron) => patron.test(texto))) graves.push('error_tecnico')
  if (SENALES_INTERNAS.some((patron) => patron.test(texto))) graves.push('interno_del_sistema')
  if (pareceRazonamiento(texto)) graves.push('razonamiento_del_modelo')
  if (pareceOtroIdioma(texto)) graves.push('idioma_incorrecto')

  const afirmaciones = detectarAfirmaciones(texto)
  if (afirmaciones.reservo && !evidencia.reservo) graves.push('reserva_sin_evidencia')
  if (afirmaciones.cancelo && !evidencia.cancelo) graves.push('cancelacion_sin_evidencia')
  if (afirmaciones.confirmo && !evidencia.confirmo) graves.push('confirmacion_sin_evidencia')

  if (graves.length) {
    /*
     * Bloquear el texto no es lo mismo que deshacer lo que ya pasó.
     *
     * Si la base dice que la hora se canceló, decirle al cliente "no pude completar eso" es
     * mentira, y encima le hace insistir sobre algo que ya está hecho. Cuando hay evidencia,
     * el respaldo dice la verdad; solo cuando no hay nada que respalde una acción se usa el
     * "no pude".
     */
    const accion = evidencia.ultima
      ?? (evidencia.cancelo ? 'cancelo' : evidencia.confirmo ? 'confirmo' : evidencia.reservo ? 'reservo' : null)
    const respaldo = accion ? RESPALDO_SEGUN_ACCION[accion] : RESPUESTA_DE_RESPALDO
    return { texto: respaldo, bloqueada: true, motivos: [...motivos, ...graves] }
  }
  return { texto, bloqueada: false, motivos }
}

/**
 * Qué pasó DE VERDAD en este turno, leído de la base y no de lo que diga el modelo.
 * Sin cliente registrado no puede haber ninguna acción, así que no hay evidencia posible.
 */
export async function reunirEvidencia(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string | null; desde: string },
): Promise<EvidenciaDelTurno> {
  if (!datos.clientId) return { reservo: false, cancelo: false, confirmo: false, ultima: null }

  const { data } = await db.from('appointments')
    .select('id,status,created_at,updated_at,client_confirmed_at')
    .eq('business_id', datos.businessId).eq('client_id', datos.clientId)
    .order('updated_at', { ascending: false }).limit(20)

  const filas = (data ?? []) as Array<{ status: string; created_at: string; updated_at: string; client_confirmed_at: string | null }>
  const reciente = (momento: string | null | undefined) => Boolean(momento && String(momento) >= datos.desde)

  const reservo = filas.some((fila) => reciente(fila.created_at) && fila.status !== 'CANCELLED')
  const cancelo = filas.some((fila) => fila.status === 'CANCELLED' && reciente(fila.updated_at))
  const confirmo = filas.some((fila) => reciente(fila.client_confirmed_at))

  /*
   * Cuál fue la ÚLTIMA, por marca de tiempo.
   *
   * En un mismo turno puede haber más de una —reservar y cancelar a los pocos minutos— y el
   * respaldo tiene que hablar de la última, no de la primera que se encuentre.
   */
  const momentos: Array<['reservo' | 'confirmo' | 'cancelo', string]> = []
  for (const fila of filas) {
    if (reciente(fila.created_at) && fila.status !== 'CANCELLED') momentos.push(['reservo', fila.created_at])
    if (fila.status === 'CANCELLED' && reciente(fila.updated_at)) momentos.push(['cancelo', fila.updated_at])
    if (reciente(fila.client_confirmed_at)) momentos.push(['confirmo', String(fila.client_confirmed_at)])
  }
  momentos.sort((a, b) => a[1].localeCompare(b[1]))

  return { reservo, cancelo, confirmo, ultima: momentos.length ? momentos[momentos.length - 1][0] : null }
}
