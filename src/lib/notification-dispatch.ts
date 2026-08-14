import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Reclamo y cierre de los avisos de la cola (`notification_outbox`).
 *
 * El riesgo que resuelve: antes se enviaba primero y se marcaba `processed_at` después. Si el
 * WhatsApp o el correo salían bien pero esa última escritura fallaba, el aviso seguía sin
 * procesar y a los 10 minutos —cuando caduca `claimed_at`— se volvía a reclamar y el cliente
 * recibía el mismo aviso otra vez.
 *
 * Ahora reclamar ES consumir el intento: apenas se reclama la fila queda marcada como
 * procesada, antes de intentar el envío. Si el envío falla, se re-arma explícitamente para
 * que se reintente. Así un envío exitoso nunca se repite, y un envío fallido solo pierde el
 * reintento si además falla la escritura del re-armado (dos fallos seguidos sobre la misma
 * fila), en vez de duplicar avisos de forma rutinaria.
 */

export const MAXIMO_INTENTOS = 5

/**
 * Marca que queda en la fila mientras se intenta la entrega. Si una fila se queda con esta
 * marca es que el proceso murió entre el envío y la escritura del resultado: no se sabe si
 * el aviso salió. No se reintenta sola (duplicaría), pero queda visible para revisarla.
 */
export const MARCA_EN_VUELO = 'entregando'

export type AvisoReclamado = {
  id: number
  business_id: string
  appointment_id: string | null
  client_id: string
  event_type: string
  channel: string
  payload: Record<string, unknown> | null
  attempts?: number
}

export async function claimNotifications(db: SupabaseClient, limite = 50) {
  const { data, error } = await db.rpc('claim_due_notifications', { p_limit: limite })
  if (error) return { avisos: [] as AvisoReclamado[], error }

  const avisos = (data ?? []) as AvisoReclamado[]
  if (!avisos.length) return { avisos, error: null }

  // Consumir el intento ANTES de mandar nada: es lo que impide el aviso duplicado.
  const { error: marcaError } = await db.from('notification_outbox')
    .update({ processed_at: new Date().toISOString(), last_error: MARCA_EN_VUELO })
    .in('id', avisos.map((aviso) => aviso.id))
  if (marcaError) return { avisos: [] as AvisoReclamado[], error: marcaError }

  return { avisos, error: null }
}

/** El aviso salió: solo se suelta el reclamo, ya quedó procesado. */
export async function marcarAvisoEnviado(db: SupabaseClient, id: number) {
  await db.from('notification_outbox').update({ claimed_at: null, last_error: null }).eq('id', id)
}

/** El envío falló: se re-arma para reintentar, salvo que ya se hayan agotado los intentos. */
export async function reintentarAviso(db: SupabaseClient, aviso: AvisoReclamado, motivo: string) {
  const agotado = (aviso.attempts ?? 0) >= MAXIMO_INTENTOS
  await db.from('notification_outbox').update({
    processed_at: agotado ? new Date().toISOString() : null,
    claimed_at: null,
    last_error: motivo.slice(0, 1000),
  }).eq('id', aviso.id)
  return { reintentara: !agotado }
}

/**
 * Avisos que quedaron con la marca de entrega en vuelo: se envió (o no) y nunca se pudo
 * escribir el resultado. No se reintentan automáticamente —duplicar un recordatorio es
 * justamente lo que se quiso evitar— pero se cuentan para que el fallo sea visible.
 */
export async function contarAvisosAmbiguos(db: SupabaseClient, anteriorA: Date) {
  const { count } = await db.from('notification_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('last_error', MARCA_EN_VUELO)
    .not('processed_at', 'is', null)
    .lte('processed_at', anteriorA.toISOString())
  return count ?? 0
}

/** El aviso ya no corresponde (cita cancelada, sin plantilla, sin datos): queda procesado. */
export async function descartarAviso(db: SupabaseClient, aviso: AvisoReclamado, motivo: string) {
  await db.from('notification_outbox')
    .update({ processed_at: new Date().toISOString(), claimed_at: null, last_error: motivo })
    .eq('id', aviso.id)
}
