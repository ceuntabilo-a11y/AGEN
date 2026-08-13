import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Entrega durable de la respuesta del agente.
 *
 * La respuesta YA VALIDADA se guarda en la fila de `agent_inbox` del mensaje que la disparó,
 * ANTES de intentar mandarla. Si la ejecución de n8n muere entera —o el proveedor está caído—
 * la fila queda pendiente y otra pasada reintenta exactamente ese texto.
 *
 * Lo que un reintento NO hace, por construcción: no vuelve a correr el modelo, no vuelve a
 * llamar ninguna tool y no puede crear, cancelar ni modificar nada. Solo reintenta el envío.
 *
 * Sin idempotencia del proveedor: ni Evolution API, ni WhatsApp Cloud API (META), ni
 * 360dialog aceptan una clave de idempotencia en el envío de mensajes, así que "exactamente
 * una vez" no se puede garantizar de punta a punta. Lo que sí se garantiza acá:
 * - una sola pasada reclama una respuesta a la vez (reclamo exclusivo sobre `reply_claimed_at`);
 * - una respuesta con `reply_sent_at` no se reintenta nunca más;
 * - los intentos están acotados (`MAXIMO_INTENTOS_ENVIO`);
 * - hay un margen antes del primer reintento para no competir con la ejecución que la creó.
 * El caso que puede duplicar sigue siendo el ambiguo: el proveedor entregó pero no alcanzamos
 * a escribir el resultado. Se prefiere ese riesgo a dejar al cliente sin respuesta.
 */

export const MAXIMO_INTENTOS_ENVIO = 3
/** Margen antes de tocar una respuesta pendiente: la ejecución original puede seguir viva. */
export const MARGEN_REINTENTO_SEGUNDOS = 120
/** Cuánto puede tener reclamada una respuesta otra pasada antes de darla por abandonada. */
const RECLAMO_VENCE_MINUTOS = 5

export type RespuestaPendiente = {
  id: number
  business_id: string
  phone: string
  message_id: string
  reply_text: string
  reply_attempts: number
}

type Clave = { businessId: string; phone: string; messageId: string }

/** PostgREST avisa así cuando la columna no existe: la migración todavía no se aplicó. */
function faltaLaMigracion(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === 'PGRST204' || error.code === '42703' || /reply_(text|sent_at|attempts|claimed_at|error)/.test(error.message ?? '')
}

const porClave = (consulta: any, clave: Clave) =>
  consulta.eq('business_id', clave.businessId).eq('phone', clave.phone).eq('message_id', clave.messageId)

/**
 * Guarda la respuesta validada antes de enviarla y deja la fila reclamada por esta ejecución.
 * Devuelve `durable:false` si la migración todavía no está aplicada: en ese caso el envío
 * sigue funcionando, pero sin red de rescate.
 */
export async function guardarRespuestaPendiente(db: SupabaseClient, datos: Clave & { texto: string }) {
  const { data, error } = await porClave(db.from('agent_inbox').update({
    reply_text: datos.texto.slice(0, 4000),
    reply_claimed_at: new Date().toISOString(),
    reply_attempts: 1,
    reply_error: null,
    reply_sent_at: null,
  }), datos).select('id')

  if (faltaLaMigracion(error)) return { durable: false, guardada: false }
  if (error) return { durable: true, guardada: false }
  return { durable: true, guardada: (data ?? []).length > 0 }
}

/** La respuesta salió: la fila deja de estar pendiente para siempre. */
export async function marcarRespuestaEnviada(db: SupabaseClient, clave: Clave) {
  const { error } = await porClave(db.from('agent_inbox').update({
    reply_sent_at: new Date().toISOString(),
    reply_claimed_at: null,
    reply_error: null,
  }), clave)
  return !faltaLaMigracion(error) && !error
}

/** El envío falló: se suelta el reclamo para que otra pasada pueda reintentarlo. */
export async function marcarRespuestaFallida(db: SupabaseClient, clave: Clave, motivo: string) {
  await porClave(db.from('agent_inbox').update({
    reply_claimed_at: null,
    reply_error: motivo.slice(0, 500),
  }), clave)
}

/**
 * Reclama de forma exclusiva las respuestas que quedaron sin salir.
 *
 * El reclamo es un UPDATE condicional sobre `reply_claimed_at`: dos pasadas simultáneas no
 * pueden llevarse la misma respuesta, así que no puede haber dos envíos en paralelo.
 */
export async function reclamarRespuestasPendientes(
  db: SupabaseClient,
  opciones: { ahora?: Date; limite?: number; margenSegundos?: number } = {},
) {
  const ahora = opciones.ahora ?? new Date()
  const margen = opciones.margenSegundos ?? MARGEN_REINTENTO_SEGUNDOS
  const limite = opciones.limite ?? 20
  const anteriorA = new Date(ahora.getTime() - margen * 1000).toISOString()
  const reclamoVencido = new Date(ahora.getTime() - RECLAMO_VENCE_MINUTOS * 60000).toISOString()

  const { data, error } = await db.from('agent_inbox')
    .select('id,business_id,phone,message_id,reply_text,reply_attempts,reply_claimed_at')
    .not('reply_text', 'is', null).is('reply_sent_at', null)
    .lt('reply_attempts', MAXIMO_INTENTOS_ENVIO)
    .lte('created_at', anteriorA)
    .order('created_at').limit(limite)
  if (faltaLaMigracion(error)) return { durable: false, respuestas: [] as RespuestaPendiente[] }
  if (error) return { durable: true, respuestas: [] as RespuestaPendiente[] }

  const candidatas = (data ?? []) as Array<RespuestaPendiente & { reply_claimed_at: string | null }>
  const reclamadas: RespuestaPendiente[] = []

  for (const fila of candidatas) {
    if (fila.reply_claimed_at && fila.reply_claimed_at > reclamoVencido) continue
    // CAS: solo se la lleva quien encuentre el reclamo como lo leyó.
    let consulta = db.from('agent_inbox')
      .update({ reply_claimed_at: ahora.toISOString(), reply_attempts: (fila.reply_attempts ?? 0) + 1 })
      .eq('id', fila.id).is('reply_sent_at', null)
    consulta = fila.reply_claimed_at
      ? consulta.eq('reply_claimed_at', fila.reply_claimed_at)
      : consulta.is('reply_claimed_at', null)
    const { data: tomada } = await consulta.select('id')
    if ((tomada ?? []).length) reclamadas.push(fila)
  }

  return { durable: true, respuestas: reclamadas }
}
