/**
 * Camino rápido: los turnos que no necesitan al modelo.
 *
 * Es la idea del patrón «chat supervisor» de `openai/openai-realtime-agents` (ver
 * `referencias/openai-realtime-agents`): lo barato lo contesta algo barato, y el modelo caro solo
 * entra cuando de verdad hay que decidir o usar una herramienta. Acá se lleva un paso más allá:
 * lo barato no es un modelo pequeño, es una función determinista. Un saludo no tiene nada que
 * decidir, así que no hay nada que pueda alucinar.
 *
 * Qué gana: medido contra producción, un turno completo cuesta ~17 s, de los cuales 8–18 s son
 * la llamada al modelo. Un «hola» sale por acá en el tiempo del envío por WhatsApp y nada más.
 *
 * La regla de oro es la inversa de la de un modelo: ante la duda, NO contestar. Devolver `null`
 * solo significa «que lo atienda el agente», que es lo que pasaba antes. Por eso las condiciones
 * son estrechas a propósito y el mensaje tiene que ser EXACTAMENTE un saludo, un agradecimiento
 * o una despedida, sin nada más pegado.
 */

/**
 * Lo que se le quita al mensaje antes de compararlo: no cambia lo que dice, solo cómo se ve.
 *
 * Escrito con rangos explícitos y sin la bandera `u` porque el proyecto compila a ES5 (ver
 * `tsconfig.json`), donde `\p{…}` no existe. Cubre espacios, signos ASCII, los signos latinos
 * (¡ ¿ « »…), puntuación y símbolos generales, y los emojis, que en ES5 son pares suplentes
 * `\uD800-\uDFFF` más el selector de variación y el unificador de ancho cero.
 */
const ADORNOS = /[\s!-/:-@[-`{-~¡-¿‍ -㏿\uD800-\uDFFF️]+/g

/** Marcas de acento en forma descompuesta (NFD). */
const ACENTOS = /[̀-ͯ]/g

/** Acentos fuera: «buenos días» y «buenos dias» son el mismo saludo. */
function normalizar(mensaje: string) {
  return mensaje
    .normalize('NFD').replace(ACENTOS, '')
    .toLowerCase()
    .replace(ADORNOS, ' ')
    .trim()
}

/**
 * Repeticiones de la última letra («holaaa», «graciasss») y nada más: es la misma palabra.
 * No se toca ninguna otra letra, así que «buenas» nunca se convierte en otra cosa.
 */
function sinAlargues(palabra: string) {
  return palabra.replace(/(.)\1{2,}/g, '$1')
}

const SALUDOS = new Set([
  'hola', 'holi', 'hey', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches',
  'buen dia', 'hola buenas', 'hola buenos dias', 'hola buenas tardes', 'hola buenas noches',
  'que tal', 'holaa', 'alo', 'aloo',
])

const AGRADECIMIENTOS = new Set([
  'gracias', 'muchas gracias', 'mil gracias', 'muchisimas gracias', 'gracias totales',
  'te agradezco', 'muy amable', 'graciass',
])

const DESPEDIDAS = new Set([
  'chao', 'chau', 'adios', 'bye', 'nos vemos', 'hasta luego', 'hasta pronto',
  'chao gracias', 'gracias chao', 'buenas noches chao',
])

/**
 * Palabras que descartan el camino rápido aunque el mensaje empiece con un saludo.
 *
 * «ok», «sí» y «dale» aceptan LO ÚLTIMO que se propuso (regla 16 del prompt): contestarlas con un
 * saludo enlatado sería perder el hilo de la conversación. Las demás son intención real.
 */
const NUNCA_RAPIDO = /\b(ok|oka|okey|si|sip|dale|bueno|ya|no|hora|horas|reserva|reservar|agendar|cita|cancelar|cambiar|mover|precio|cuanto|cuando|disponible|disponibilidad|atienden|abren|cierran|direccion|donde|confirmo|confirmar)\b/

export type TurnoRapido = { texto: string; motivo: 'SALUDO' | 'AGRADECIMIENTO' | 'DESPEDIDA' }

/**
 * Decide si este turno se puede contestar sin el modelo.
 *
 * @param mensaje  Lo que escribió el cliente, tal cual.
 * @param datos    `actorType` y `pendingNotice` del contexto, más el nombre del negocio.
 * @returns        El texto a enviar, o `null` para que conteste el agente de siempre.
 */
export function respuestaRapida(
  mensaje: string | null | undefined,
  datos: { actorType?: unknown; pendingNotice?: unknown; businessName?: string | null },
): TurnoRapido | null {
  // El equipo nunca pasa por acá: sus respuestas salen de la agenda del día, no de una plantilla.
  if (datos.actorType !== 'CLIENT') return null
  // Con un aviso vivo, un mensaje suelto puede estar contestándolo (reglas 20–23): manda el agente.
  if (datos.pendingNotice) return null

  const texto = String(mensaje ?? '')
  // Un mensaje largo nunca es solo un saludo; comparar palabra a palabra ya lo cubre, pero esto
  // evita normalizar cadenas grandes en cada turno.
  if (!texto.trim() || texto.length > 60) return null

  const limpio = sinAlargues(normalizar(texto))
  if (!limpio || NUNCA_RAPIDO.test(limpio)) return null

  const negocio = String(datos.businessName ?? '').trim()

  if (SALUDOS.has(limpio)) {
    return {
      motivo: 'SALUDO',
      texto: negocio
        ? `¡Hola! Soy la asistente de ${negocio}. ¿En qué te puedo ayudar?`
        : '¡Hola! ¿En qué te puedo ayudar?',
    }
  }
  if (AGRADECIMIENTOS.has(limpio)) {
    return { motivo: 'AGRADECIMIENTO', texto: '¡De nada! Cualquier cosa me escribes 😊' }
  }
  if (DESPEDIDAS.has(limpio)) {
    return { motivo: 'DESPEDIDA', texto: '¡Hasta pronto! Que estés muy bien 😊' }
  }
  return null
}
