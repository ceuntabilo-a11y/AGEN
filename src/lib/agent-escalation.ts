import type { SupabaseClient } from '@supabase/supabase-js'
import { escalarHilo } from '@/lib/agent-thread'
import { registrar } from '@/lib/observabilidad'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { sendWhatsApp } from '@/lib/whatsapp'

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

const MOTIVO_EN_PALABRAS: Record<MotivoEscalacion, string> = {
  PAGO: 'una consulta de pago',
  QUEJA: 'un reclamo',
  SEGURIDAD: 'un asunto de seguridad',
  PETICION_CLIENTE: 'que pidió hablar con una persona',
  FUERA_DE_ALCANCE: 'algo que el agente no puede resolver',
}

/**
 * El aviso que le llega por WhatsApp a la persona del negocio.
 *
 * Lleva lo único que hace falta para atender sin volver a preguntar: quién es, por qué se
 * transfiere y qué dijo. Se escribe acá, en código, para que siempre diga lo mismo y para poder
 * probarlo sin mandar mensajes.
 */
export function textoDeTransferencia(datos: {
  clientName?: string | null
  clientPhone: string
  motivo: MotivoEscalacion
  detalle: string
  businessName?: string | null
}): string {
  const quien = datos.clientName?.trim() || 'Un cliente'
  return [
    `🔔 *Se necesita que atiendas tú*${datos.businessName ? ` · ${datos.businessName}` : ''}`,
    '',
    `Cliente: ${quien} (+${normalizePhone(datos.clientPhone)})`,
    `Motivo: ${MOTIVO_EN_PALABRAS[datos.motivo]}`,
    '',
    `Lo que dijo: "${datos.detalle.trim().slice(0, 400)}"`,
    '',
    'Escríbele tú directamente: el agente ya le avisó que lo vas a contactar.',
  ].join('\n')
}

export type ResultadoEscalacion = {
  escalated: boolean
  /** Si además se le mandó el WhatsApp a la persona configurada. */
  avisadoPorWhatsApp?: boolean
  alreadyDone?: boolean
  notified?: number
  conversationId?: string | null
  reason?: string
  businessPhone?: string | null
  error?: string
  estado?: number
}

/** Manda el aviso al número que configuró el negocio. Devuelve si de verdad se entregó. */
async function avisarPorWhatsApp(
  db: SupabaseClient,
  datos: { businessId: string; phone: string; motivo: MotivoEscalacion; detalle: string; clientName?: string | null },
): Promise<boolean> {
  try {
    const { data: negocio } = await db.from('businesses')
      .select('name,agent_settings,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key')
      .eq('id', datos.businessId).maybeSingle()
    if (!negocio) return false

    const ajustes = (negocio.agent_settings ?? {}) as Record<string, unknown>
    if (ajustes.human_handoff_enabled === false) return false

    const destino = normalizePhone(ajustes.handoff_phone)
    if (!isRealClientPhone(destino)) {
      registrar('aviso', 'agent_handoff_sin_numero', { businessId: datos.businessId, motivo: datos.motivo })
      return false
    }

    const envio = await sendWhatsApp(negocio as never, {
      phone: destino,
      text: textoDeTransferencia({
        clientName: datos.clientName, clientPhone: datos.phone,
        motivo: datos.motivo, detalle: datos.detalle, businessName: negocio.name,
      }),
    })
    if (!envio.success) registrar('error', 'agent_handoff_no_entregado', { businessId: datos.businessId, detalle: envio.error })
    return envio.success
  } catch (error) {
    registrar('error', 'agent_handoff_excepcion', { businessId: datos.businessId, detalle: String(error) })
    return false
  }
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

  /*
   * El WhatsApp a la persona del negocio: lo que hacía falta para que «transferir a una persona»
   * dejara de ser una casilla decorativa.
   *
   * Hasta ahora escalar solo dejaba una campanita en el panel: si nadie tenía el panel abierto,
   * el cliente esperaba a alguien que no sabía que lo estaban esperando. El número lo configura
   * el negocio en `/admin/agente` (`agent_settings.handoff_phone`) y es UNO por negocio.
   *
   * Nunca puede tumbar la escalación: si no hay número, o el envío falla, el aviso del panel se
   * crea igual y se responde `avisadoPorWhatsApp: false`.
   */
  const avisadoPorWhatsApp = await avisarPorWhatsApp(db, datos)

  const { data: equipo } = await db.from('business_members')
    .select('user_id,role').eq('business_id', datos.businessId).eq('active', true).in('role', ROLES_QUE_ATIENDEN)

  const destinatarios = (equipo ?? []).map((item) => item.user_id).filter(Boolean)
  if (!destinatarios.length) {
    registrar('aviso', 'agent_escalate_sin_equipo', { businessId: datos.businessId, motivo: datos.motivo })
    // Con el WhatsApp entregado, alguien SÍ se enteró aunque no haya nadie con cuenta en el panel.
    return {
      escalated: avisadoPorWhatsApp, avisadoPorWhatsApp,
      reason: avisadoPorWhatsApp ? undefined : 'sin_equipo',
      businessPhone: datos.businessPhone ?? null, conversationId,
    }
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
    businessId: datos.businessId, motivo: datos.motivo, destinatarios: destinatarios.length,
    nuevos: filas.length, repetida, avisadoPorWhatsApp,
  })
  return { escalated: true, alreadyDone: repetida, notified: destinatarios.length, conversationId, avisadoPorWhatsApp }
}
