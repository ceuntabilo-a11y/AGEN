import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Hilo de la conversación (`conversations` + `messages`): la única copia literal de lo que
 * se habló, y lo que se lee en el panel de Conversaciones.
 *
 * Se guarda SIEMPRE, incluso cuando quien escribe todavía no es cliente del negocio:
 * `conversations.client_id` es opcional y el panel ya muestra "Cliente sin registrar". Antes
 * se descartaba todo el intercambio, así que la primera conversación —justo la de alguien que
 * está preguntando por primera vez— desaparecía sin dejar rastro.
 *
 * Lo que NO se guarda sin cliente es la memoria del agente (`client_memory` cuelga de
 * `clients`): un teléfono que todavía no es cliente no tiene ficha donde guardar preferencias.
 */

export const CANALES = ['WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'WEB', 'EMAIL']

export async function guardarHilo(
  db: SupabaseClient,
  datos: {
    businessId: string
    clientId: string | null
    channel: string
    externalId: string
    message: string
    reply: string
  },
) {
  let consulta = db.from('conversations').select('id,client_id')
    .eq('business_id', datos.businessId).eq('channel', datos.channel).neq('status', 'CLOSED')
  // Con ficha se busca por cliente O por teléfono: así el hilo que se abrió cuando todavía
  // no era cliente se sigue usando en vez de quedar huérfano y abrir uno nuevo.
  consulta = datos.clientId
    ? consulta.or(`client_id.eq.${datos.clientId},external_id.eq.${datos.externalId}`)
    : consulta.eq('external_id', datos.externalId)

  const { data: abierta } = await consulta.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  let conversationId: string | null = abierta?.id ?? null

  if (!conversationId) {
    const { data: creada } = await db.from('conversations').insert({
      business_id: datos.businessId,
      client_id: datos.clientId,
      channel: datos.channel,
      external_id: datos.externalId,
      status: 'OPEN',
    }).select('id').single()
    conversationId = creada?.id ?? null
  }
  if (!conversationId) return { conversationId: null }

  await db.from('messages').insert([
    { conversation_id: conversationId, direction: 'INBOUND', sender: 'CLIENT', content: datos.message },
    { conversation_id: conversationId, direction: 'OUTBOUND', sender: 'AI', content: datos.reply },
  ])
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

  // Si la persona se registró después, el hilo que se abrió sin ficha se enlaza con ella.
  if (datos.clientId && abierta && !abierta.client_id) {
    await db.from('conversations').update({ client_id: datos.clientId }).eq('id', conversationId).is('client_id', null)
  }
  return { conversationId }
}
