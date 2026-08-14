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

/**
 * Conversación abierta de este teléfono en este canal, o la crea.
 *
 * `existia` distingue "ya había un hilo" de "acabo de abrirlo", que es lo que necesita
 * `guardarHilo` para enlazar con la ficha del cliente un hilo que se abrió antes de que la
 * persona se registrara.
 */
async function hiloAbierto(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string | null; channel: string; externalId: string },
): Promise<{ id: string | null; existia: boolean; clientIdPrevio: string | null }> {
  let consulta = db.from('conversations').select('id,client_id')
    .eq('business_id', datos.businessId).eq('channel', datos.channel).neq('status', 'CLOSED')
  consulta = datos.clientId
    ? consulta.or(`client_id.eq.${datos.clientId},external_id.eq.${datos.externalId}`)
    : consulta.eq('external_id', datos.externalId)

  const { data: abierta } = await consulta.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (abierta?.id) return { id: abierta.id, existia: true, clientIdPrevio: abierta.client_id ?? null }

  const { data: creada } = await db.from('conversations').insert({
    business_id: datos.businessId,
    client_id: datos.clientId,
    channel: datos.channel,
    external_id: datos.externalId,
    status: 'OPEN',
  }).select('id').single()
  return { id: creada?.id ?? null, existia: false, clientIdPrevio: null }
}

/**
 * Pasa la conversación a manos de una persona.
 *
 * `conversations.status = 'HUMAN'` existe en el esquema desde el principio y no lo usaba
 * nadie: el agente decía "¿quieres que avise al equipo?" y, dijera el cliente lo que dijera,
 * no ocurría absolutamente nada. Esta es la mitad que faltaba — el estado del hilo — y el
 * aviso al equipo lo pone `/api/agent/escalate` encima.
 *
 * Deja además un mensaje `SYSTEM` en el hilo, para que quien lo abra en el panel vea por qué
 * está escalado y con qué palabras lo pidió el cliente, sin tener que deducirlo.
 */
export async function escalarHilo(
  db: SupabaseClient,
  datos: {
    businessId: string
    clientId: string | null
    channel: string
    externalId: string
    motivo: string
    detalle: string
  },
): Promise<{ conversationId: string | null; yaEstaba: boolean }> {
  const { id: conversationId } = await hiloAbierto(db, datos)
  if (!conversationId) return { conversationId: null, yaEstaba: false }

  const { data: previo } = await db.from('conversations').select('status').eq('id', conversationId).maybeSingle()
  const yaEstaba = previo?.status === 'HUMAN'

  await db.from('conversations')
    .update({ status: 'HUMAN', updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  // Un solo mensaje de sistema por escalación: si ya estaba escalado no se repite, para que el
  // hilo no se llene de la misma línea cada vez que el cliente insiste.
  if (!yaEstaba) {
    await db.from('messages').insert({
      conversation_id: conversationId,
      direction: 'INBOUND',
      sender: 'SYSTEM',
      content: `Conversación derivada al equipo (${datos.motivo}): ${datos.detalle}`.slice(0, 1000),
    })
  }
  return { conversationId, yaEstaba }
}

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
  // Con ficha se busca por cliente O por teléfono: así el hilo que se abrió cuando todavía
  // no era cliente se sigue usando en vez de quedar huérfano y abrir uno nuevo.
  const { id: conversationId, existia, clientIdPrevio } = await hiloAbierto(db, datos)
  if (!conversationId) return { conversationId: null }

  await db.from('messages').insert([
    { conversation_id: conversationId, direction: 'INBOUND', sender: 'CLIENT', content: datos.message },
    { conversation_id: conversationId, direction: 'OUTBOUND', sender: 'AI', content: datos.reply },
  ])
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

  // Si la persona se registró después, el hilo que se abrió sin ficha se enlaza con ella.
  if (datos.clientId && existia && !clientIdPrevio) {
    await db.from('conversations').update({ client_id: datos.clientId }).eq('id', conversationId).is('client_id', null)
  }
  return { conversationId }
}
