import type { SupabaseClient } from '@supabase/supabase-js'
import { escalarHilo } from '@/lib/agent-thread'
import { registrar } from '@/lib/observabilidad'

/**
 * Avisar a una persona del equipo, de verdad.
 *
 * Estaba entero dentro de `/api/agent/escalate`. Se saca acá sin cambiar una sola regla porque
 * ahora hay dos entradas: esa ruta (herramienta histórica) y el ejecutor fijo
 * `/api/agent/act`, al que llega la intención ESCALAR desde el router.
 */

export const MOTIVOS_ESCALACION = ['PAGO', 'QUEJA', 'SEGURIDAD', 'PETICION_CLIENTE', 'FUERA_DE_ALCANCE'] as const
export type MotivoEscalacion = (typeof MOTIVOS_ESCALACION)[number]

const TITULO: Record<MotivoEscalacion, string> = {
  PAGO: 'Consulta de pago por WhatsApp',
  QUEJA: 'Reclamo de un cliente por WhatsApp',
  SEGURIDAD: 'Asunto de seguridad por WhatsApp',
  PETICION_CLIENTE: 'Un cliente pide hablar con una persona',
  FUERA_DE_ALCANCE: 'Consulta que el agente no puede resolver',
}

/** Un PROFESSIONAL atiende su agenda, no la recepción. */
const ROLES_QUE_ATIENDEN = ['OWNER', 'ADMIN', 'RECEPTIONIST']

export type ResultadoEscalacion = {
  escalated: boolean
  alreadyDone?: boolean
  notified?: number
  conversationId?: string | null
  reason?: string
  businessPhone?: string | null
  error?: string
  estado?: number
}

export async function escalarConAviso(
  db: SupabaseClient,
  datos: {
    businessId: string
    phone: string
    motivo: MotivoEscalacion
    detalle: string
    channel?: string
    businessPhone?: string | null
    clientId?: string | null
    clientName?: string | null
  },
): Promise<ResultadoEscalacion> {
  const canal = datos.channel === 'INSTAGRAM' || datos.channel === 'MESSENGER' ? datos.channel : 'WHATSAPP'
  const { conversationId, yaEstaba } = await escalarHilo(db, {
    businessId: datos.businessId,
    clientId: datos.clientId ?? null,
    channel: canal,
    externalId: datos.phone,
    motivo: datos.motivo,
    detalle: datos.detalle,
  })
  if (!conversationId) {
    registrar('error', 'agent_escalate_sin_hilo', { businessId: datos.businessId, motivo: datos.motivo })
    return { escalated: false, error: 'No se pudo abrir el aviso', estado: 500 }
  }

  const { data: equipo } = await db.from('business_members')
    .select('user_id,role').eq('business_id', datos.businessId).eq('active', true).in('role', ROLES_QUE_ATIENDEN)

  const destinatarios = (equipo ?? []).map((item) => item.user_id).filter(Boolean)
  if (!destinatarios.length) {
    registrar('aviso', 'agent_escalate_sin_equipo', { businessId: datos.businessId, motivo: datos.motivo })
    return { escalated: false, reason: 'sin_equipo', businessPhone: datos.businessPhone ?? null, conversationId }
  }

  const eventKey = `escalacion:${conversationId}:${datos.motivo}`
  const { data: yaAvisados } = await db.from('team_notifications')
    .select('recipient_user_id').eq('event_key', eventKey).in('recipient_user_id', destinatarios)
  const conAviso = new Set((yaAvisados ?? []).map((item) => item.recipient_user_id))
  const pendientes = destinatarios.filter((userId) => !conAviso.has(userId))

  const quien = datos.clientName ? `${datos.clientName} (${datos.phone})` : datos.phone
  const filas = pendientes.map((userId) => ({
    business_id: datos.businessId,
    recipient_user_id: userId,
    event_key: eventKey,
    kind: 'ESCALATION',
    title: TITULO[datos.motivo].slice(0, 160),
    body: `${quien}: ${datos.detalle}`.slice(0, 1000),
    payload: { conversationId, phone: datos.phone, motivo: datos.motivo, clientId: datos.clientId ?? null },
  }))

  if (filas.length) {
    const { error } = await db.from('team_notifications').upsert(filas, {
      onConflict: 'recipient_user_id,event_key',
      ignoreDuplicates: true,
    })
    if (error) {
      registrar('error', 'agent_escalate_aviso_falla', { businessId: datos.businessId, motivo: datos.motivo, detalle: error.message })
      return { escalated: false, error: 'No se pudo avisar al equipo', estado: 500 }
    }
  }

  const repetida = yaEstaba && !filas.length
  registrar('info', 'agent_escalate', {
    businessId: datos.businessId, motivo: datos.motivo, destinatarios: destinatarios.length, nuevos: filas.length, repetida,
  })
  return { escalated: true, alreadyDone: repetida, notified: destinatarios.length, conversationId }
}
