import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAviso } from '@/lib/observabilidad'

/**
 * La nota que el cliente responde a una encuesta, reconocida y guardada SIN modelo.
 *
 * Una calificación es un número: no hace falta que nadie la interprete. Antes esto no existía
 * en ninguna parte — la encuesta tenía plantilla, la tabla `survey_responses` tenía una columna
 * `source = 'AI_AGENT'` preparada, y ningún código escribía nunca en ella. Es decir: aunque el
 * cliente contestara «9», la nota se perdía.
 *
 * La escala es 1–10, que es la que acepta la tabla (`score between 0 and 10`). El texto que se
 * le manda al cliente pide exactamente eso, para que las tres cosas digan lo mismo.
 */

/** «9», «9/10», «9 de 10», «le doy un 9». Nunca una hora («9:30») ni un precio. */
const NOTA = /(?:^|\s)(?:le\s+doy\s+(?:un\s+)?)?(10|[0-9])(?:\s*(?:\/|de)\s*10)?(?=\s*$|\s+[a-záéíóúñ])/i

/**
 * Palabras que convierten el número en otra cosa: «10 minutos tarde» no es un diez.
 * Es la diferencia entre guardar una nota y guardar una mentira.
 */
const NO_ES_NOTA = /^(minutos?|min|horas?|hrs?|am|pm|de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|mil|pesos|personas?|a\s+las)\b/i

export function notaDelMensaje(mensaje: string): number | null {
  const texto = String(mensaje ?? '').trim()
  if (!texto) return null
  // Una hora («a las 9», «9:30») o una fecha no son una nota.
  if (/\d\s*[:.]\s*\d/.test(texto)) return null
  const encontrado = NOTA.exec(texto)
  if (!encontrado) return null
  const despues = texto.slice((encontrado.index ?? 0) + encontrado[0].length).trim()
  if (NO_ES_NOTA.test(despues)) return null
  const nota = Number(encontrado[1])
  return Number.isInteger(nota) && nota >= 0 && nota <= 10 ? nota : null
}

/** Lo que el cliente escribió además del número, para guardarlo como comentario. */
export function comentarioDelMensaje(mensaje: string): string | null {
  const limpio = String(mensaje ?? '').replace(NOTA, ' ').replace(/\s{2,}/g, ' ').trim()
  return limpio.length >= 3 ? limpio.slice(0, 500) : null
}

export type NotaGuardada = { guardada: boolean; nota: number }

/**
 * Guarda la nota. Nunca puede tumbar el turno: si la migración de encuestas no está aplicada o
 * la escritura falla, se registra y el cliente recibe igual su agradecimiento.
 */
export async function guardarNotaDeEncuesta(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string; appointmentId?: string | null; nota: number; comentario?: string | null },
): Promise<NotaGuardada> {
  try {
    const fila: Record<string, unknown> = {
      business_id: datos.businessId,
      client_id: datos.clientId,
      score: datos.nota,
      comment: datos.comentario ?? null,
      source: 'AI_AGENT',
    }
    if (datos.appointmentId) fila.appointment_id = datos.appointmentId

    const { error } = await db.from('survey_responses').insert(fila)
    if (error) {
      registrarAviso('encuesta_nota_no_guardada', { businessId: datos.businessId, detalle: error.message })
      return { guardada: false, nota: datos.nota }
    }
    return { guardada: true, nota: datos.nota }
  } catch (error) {
    registrarAviso('encuesta_nota_no_guardada', { businessId: datos.businessId, detalle: String(error) })
    return { guardada: false, nota: datos.nota }
  }
}

/**
 * A partir de qué nota se le pide la reseña en Google.
 *
 * Es la regla clásica de NPS: solo los promotores. Pedírsela a quien puso un 6 es pedirle que
 * publique un 6, y esa reseña queda para siempre.
 */
export const NOTA_MINIMA_PARA_RESENA = 9

/** ¿Este cliente es promotor y el negocio tiene dónde mandarlo? */
export function correspondePedirResena(nota: number, enlace: string | null | undefined): boolean {
  return nota >= NOTA_MINIMA_PARA_RESENA && esEnlaceDeResena(enlace)
}

/** Un enlace de reseña utilizable: http(s) y nada más. */
export function esEnlaceDeResena(valor: unknown): valor is string {
  const texto = String(valor ?? '').trim()
  if (!texto) return false
  try {
    return ['http:', 'https:'].includes(new URL(texto).protocol)
  } catch {
    return false
  }
}

/**
 * El agradecimiento, escrito por código y proporcional a la nota.
 *
 * Con 9 o 10 —y solo entonces— se le pide además la reseña en Google, con el enlace que el
 * negocio guardó en su configuración. Sin enlace configurado, se agradece y ya está: nunca se
 * inventa una dirección ni se promete algo que no existe.
 */
export function textoDeAgradecimiento(nota: number, enlaceResena?: string | null): string {
  if (nota >= NOTA_MINIMA_PARA_RESENA) {
    const gracias = `¡Gracias por el ${nota}! 🙌\n\nNos alegra un montón.`
    if (!esEnlaceDeResena(enlaceResena)) return `${gracias}\n\nTe esperamos pronto.`
    return `${gracias}\n\n¿Nos ayudas con una reseña en Google? Te toma menos de un minuto y nos ayuda muchísimo a que otras personas nos encuentren:\n${String(enlaceResena).trim()}\n\n¡Gracias de verdad! 💜`
  }
  if (nota >= 7) return `¡Gracias por tu nota (${nota})! 😊\n\nSi hay algo que podamos mejorar, cuéntamelo por aquí.`
  return `Gracias por tu sinceridad (${nota}).\n\nLamento que no haya sido como esperabas: le paso tu comentario al equipo para que lo revisen.`
}
