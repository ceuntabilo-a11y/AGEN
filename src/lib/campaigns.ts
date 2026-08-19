import type { SupabaseClient } from '@supabase/supabase-js'
import type { Audience } from '@/lib/campaign-audience'

/** Estados desde los que una campaña todavía se puede enviar. */
export const ESTADOS_ENVIABLES = ['DRAFT', 'SCHEDULED']

export type MotivoNoEnviable = 'inexistente' | 'ya_enviada' | 'en_proceso' | 'no_enviable' | 'fallo'

/** La fila de `campaigns` tal como la usa el envío. El resto de columnas viaja igual. */
export type Campana = {
  id: string
  status: string
  channel: string
  audience: Audience | null
  name: string
  content: string
  subject?: string | null
  email_html?: string | null
  image_url?: string | null
  [columna: string]: unknown
}
export type ReclamoCampana =
  | { claimed: true; campaign: Campana; estadoPrevio: string }
  | { claimed: false; motivo: MotivoNoEnviable }

/**
 * Toma la campaña para enviarla, de forma exclusiva.
 *
 * Antes se leía el estado y después se escribía `SENDING`: dos peticiones a la vez (doble
 * clic, pestaña duplicada, reintento) leían `DRAFT` las dos y las dos arrancaban un envío a
 * toda la audiencia. Y como solo se rechazaba `SENDING`, una campaña ya `SENT` se podía
 * reenviar entera con un clic de más.
 *
 * Ahora el paso a `SENDING` es un compare-and-swap: el UPDATE solo se aplica si el estado
 * sigue siendo el que se leyó. PostgreSQL bloquea la fila y la segunda petición vuelve a
 * evaluar el filtro contra la versión ya escrita, así que no afecta ninguna fila y no reclama.
 */
export async function claimCampaignForSending(
  db: SupabaseClient,
  datos: { businessId: string; campaignId: string; reanudar?: boolean },
): Promise<ReclamoCampana> {
  const { data: actual, error } = await db.from('campaigns')
    .select('*').eq('id', datos.campaignId).eq('business_id', datos.businessId).maybeSingle()
  if (error) return { claimed: false, motivo: 'fallo' }
  if (!actual) return { claimed: false, motivo: 'inexistente' }
  // Una campaña que quedó en SENDING porque el proceso murió a mitad se puede retomar, pero
  // solo si alguien lo pide explícitamente: automático sería indistinguible de un doble clic.
  // La reanudación no reenvía a nadie ya marcado SENT (ver `destinatariosYaEnviados`).
  const puedeReanudar = actual.status === 'SENDING' && datos.reanudar === true
  if (!ESTADOS_ENVIABLES.includes(actual.status) && !puedeReanudar) {
    if (actual.status === 'SENT') return { claimed: false, motivo: 'ya_enviada' }
    if (actual.status === 'SENDING') return { claimed: false, motivo: 'en_proceso' }
    return { claimed: false, motivo: 'no_enviable' }
  }

  const tomar = (campos: Record<string, unknown>) => db.from('campaigns')
    .update(campos)
    .eq('id', datos.campaignId).eq('business_id', datos.businessId).eq('status', actual.status)
    .select('id')
    .maybeSingle()

  // `sending_since` (migración 20260813000001) permite ver cuánto lleva atascada una campaña.
  // Si la migración todavía no está aplicada, se toma igual sin esa columna.
  let { data: bloqueada, error: lockError } = await tomar({ status: 'SENDING', sending_since: new Date().toISOString() })
  if (faltaColumna(lockError)) ({ data: bloqueada, error: lockError } = await tomar({ status: 'SENDING' }))
  if (lockError) return { claimed: false, motivo: 'fallo' }
  // Sin filas: otra petición se adelantó entre la lectura y el cambio de estado.
  if (!bloqueada) return { claimed: false, motivo: 'en_proceso' }

  return { claimed: true, campaign: { ...actual, status: 'SENDING' }, estadoPrevio: actual.status }
}

/** PostgREST avisa así cuando la columna no existe todavía (migración sin aplicar). */
export function faltaColumna(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === 'PGRST204' || error.code === '42703'))
}

/** Devuelve la campaña a su estado anterior cuando el envío no llegó a empezar. */
export async function restoreCampaignStatus(db: SupabaseClient, campaignId: string, estado: string) {
  const { error } = await db.from('campaigns').update({ status: estado, sending_since: null }).eq('id', campaignId)
  if (faltaColumna(error)) await db.from('campaigns').update({ status: estado }).eq('id', campaignId)
}

/**
 * Cuánto lleva una campaña en SENDING. Si supera el margen, el envío se cortó a la mitad:
 * hay que retomarlo a mano (`resume`), que solo le escribe a quien todavía no recibió.
 * Sin la columna `sending_since` no se puede saber, y se responde `false` en vez de adivinar.
 */
export const MINUTOS_PARA_DARLA_POR_ATASCADA = 15

export function campanaAtascada(
  campana: { status?: string; sending_since?: string | null },
  opciones: { ahora?: Date; minutos?: number } = {},
) {
  if (campana.status !== 'SENDING' || !campana.sending_since) return false
  const ahora = opciones.ahora ?? new Date()
  const minutos = opciones.minutos ?? MINUTOS_PARA_DARLA_POR_ATASCADA
  return new Date(campana.sending_since).getTime() <= ahora.getTime() - minutos * 60000
}

/**
 * A quién NO hay que volver a escribirle: los destinatarios que ya salieron.
 * Es lo que hace segura la reanudación de una campaña cortada a la mitad.
 */
export async function destinatariosYaEnviados(db: SupabaseClient, campaignId: string) {
  const { data } = await db.from('campaign_recipients')
    .select('client_id,status').eq('campaign_id', campaignId).eq('status', 'SENT').limit(5000)
  return new Set(((data ?? []) as Array<{ client_id: string }>).map((fila) => fila.client_id))
}

export function destinatarioKey(clientId: string, channel: string) {
  return `${clientId}:${channel}`
}

/**
 * Igual que `destinatariosYaEnviados`, pero distinguiendo el CANAL: una campaña "BOTH" puede
 * tener el WhatsApp de un cliente ya enviado y su correo todavía pendiente. Requiere la columna
 * `channel` de la migración `20260819000001`; solo se usa en el envío por los dos canales a la
 * vez, que ya comprobó antes que esa columna existe.
 */
export async function destinatariosYaEnviadosPorCanal(db: SupabaseClient, campaignId: string) {
  const { data } = await db.from('campaign_recipients')
    .select('client_id,channel,status').eq('campaign_id', campaignId).eq('status', 'SENT').limit(5000)
  return new Set(((data ?? []) as Array<{ client_id: string; channel: string | null }>)
    .map((fila) => destinatarioKey(fila.client_id, fila.channel ?? '')))
}

export async function markCampaignSent(db: SupabaseClient, campaignId: string) {
  const terminada = { status: 'SENT', sent_at: new Date().toISOString() }
  const { error } = await db.from('campaigns').update({ ...terminada, sending_since: null }).eq('id', campaignId)
  if (faltaColumna(error)) await db.from('campaigns').update(terminada).eq('id', campaignId)
}
