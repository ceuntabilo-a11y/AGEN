import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Bandeja corta de mensajes entrantes del agente.
 *
 * Vive acá y no dentro de la ruta porque el reclamo del grupo es la pieza que decide QUIÉN
 * contesta: necesita probarse con dos ejecuciones entrelazadas, y una ruta de Next no se
 * puede ejecutar fuera de su servidor.
 */

export type GrupoReclamado = { claim: boolean; message?: string; fallo?: 'consulta' | 'reclamo' }

/** Máximo de mensajes que se agrupan en una sola respuesta. */
const MAXIMO_AGRUPADO = 20

export async function registerInboxMessage(
  db: SupabaseClient,
  datos: { businessId: string; phone: string; messageId: string; content: string },
) {
  const { error } = await db.from('agent_inbox').upsert({
    business_id: datos.businessId,
    phone: datos.phone,
    message_id: datos.messageId.slice(0, 120),
    content: datos.content.slice(0, 2000),
  }, { onConflict: 'business_id,phone,message_id' })
  return !error
}

/**
 * Reclama para esta ejecución todos los mensajes pendientes del cliente.
 *
 * Devuelve `claim:true` como mucho UNA vez por grupo, aunque el webhook llegue duplicado,
 * n8n reintente o dos ejecuciones corran a la vez. Antes leía los pendientes y después los
 * marcaba consumidos en dos pasos: dos ejecuciones concurrentes leían lo mismo, las dos se
 * creían la última y las dos contestaban (respuesta doble y el modelo corriendo dos veces).
 *
 * Ahora el reclamo es un UPDATE condicional (`consumed_at is null`): PostgreSQL bloquea la
 * fila, la segunda ejecución vuelve a evaluar el filtro contra la versión ya escrita y no
 * afecta ninguna fila. Quien no recibe de vuelta su propio mensaje, no contesta.
 */
export async function claimInboxGroup(
  db: SupabaseClient,
  datos: { businessId: string; phone: string; messageId: string },
): Promise<GrupoReclamado> {
  // 1. ¿Es este el último mensaje pendiente? Si no, esta ejecución se calla y —importante—
  //    no consume nada: la ejecución del último tiene que poder agruparlos todos.
  const { data: ultimo, error } = await db.from('agent_inbox')
    .select('message_id,created_at')
    .eq('business_id', datos.businessId).eq('phone', datos.phone).is('consumed_at', null)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1)
    .maybeSingle()
  if (error) return { claim: false, fallo: 'consulta' }
  if (!ultimo || ultimo.message_id !== datos.messageId) return { claim: false }

  // 2. Reclamo atómico. `lte(created_at)` deja fuera lo que haya entrado después del paso 1:
  //    ese mensaje sigue pendiente y lo agrupará su propia ejecución, no se pierde.
  const { data: reclamadas, error: consumeError } = await db.from('agent_inbox')
    .update({ consumed_at: new Date().toISOString() })
    .eq('business_id', datos.businessId).eq('phone', datos.phone).is('consumed_at', null)
    .lte('created_at', ultimo.created_at)
    .select('id,message_id,content,created_at')
  if (consumeError) return { claim: false, fallo: 'reclamo' }

  const filas = reclamadas ?? []
  // 3. Si otra ejecución ganó la carrera, el propio mensaje ya no viene: no se contesta.
  if (!filas.some((fila) => fila.message_id === datos.messageId)) return { claim: false }

  const ordenadas = [...filas].sort((a, b) =>
    a.created_at === b.created_at ? String(a.id).localeCompare(String(b.id)) : String(a.created_at).localeCompare(String(b.created_at)))
  return {
    claim: true,
    message: ordenadas.slice(-MAXIMO_AGRUPADO).map((fila) => fila.content).filter(Boolean).join('\n'),
  }
}
