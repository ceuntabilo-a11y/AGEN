import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { rejectTeamActor } from '@/lib/agent-actor'
import { escalarHilo } from '@/lib/agent-thread'
import { registrar } from '@/lib/observabilidad'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Avisar a una persona del equipo. De verdad.
 *
 * El bug que cierra: el agente ofrecía "¿quieres que avise al equipo?" y, dijera el cliente lo
 * que dijera, no ocurría nada — no existía ninguna herramienta ni ningún endpoint detrás de
 * esa frase. Prometer una acción que no se ejecuta es peor que no ofrecerla: el cliente se
 * queda esperando una llamada que nadie sabe que tiene que hacer.
 *
 * Qué hace ahora, y todo es persistente:
 *
 * 1. `conversations.status = 'HUMAN'` — el estado ya existía en el esquema y no lo usaba nadie.
 * 2. Un mensaje `SYSTEM` en el hilo con el motivo y las palabras del cliente.
 * 3. Una fila en `team_notifications` por cada persona del equipo que puede atenderlo, que es
 *    justo lo que lee la campana del panel (`/api/notifications`).
 *
 * Idempotente: `team_notifications` tiene `unique(recipient_user_id, event_key)` y la clave se
 * deriva de la conversación y el motivo, así que un cliente que insiste tres veces no genera
 * tres avisos iguales. Se responde `alreadyDone:true` para que el agente no repita la frase.
 *
 * Nunca responde "avisado" si no avisó: si el negocio no tiene ningún miembro con cuenta,
 * devuelve `escalated:false` y el teléfono del negocio, y el prompt obliga a decir la verdad.
 */

/** Motivos aceptados. Cerrado a propósito: el modelo no inventa categorías. */
const MOTIVOS = ['PAGO', 'QUEJA', 'SEGURIDAD', 'PETICION_CLIENTE', 'FUERA_DE_ALCANCE'] as const
type Motivo = (typeof MOTIVOS)[number]

const TITULO: Record<Motivo, string> = {
  PAGO: 'Consulta de pago por WhatsApp',
  QUEJA: 'Reclamo de un cliente por WhatsApp',
  SEGURIDAD: 'Asunto de seguridad por WhatsApp',
  PETICION_CLIENTE: 'Un cliente pide hablar con una persona',
  FUERA_DE_ALCANCE: 'Consulta que el agente no puede resolver',
}

/** Quién puede atender una escalación. Un PROFESSIONAL atiende su agenda, no la recepción. */
const ROLES_QUE_ATIENDEN = ['OWNER', 'ADMIN', 'RECEPTIONIST']

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json() as {
    businessId?: string; phone?: string; reason?: string; message?: string; channel?: string
  }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) {
    return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })
  }
  const motivo = MOTIVOS.includes(body.reason as Motivo) ? body.reason as Motivo : null
  if (!motivo) {
    return NextResponse.json({ error: `Motivo inválido. Usa uno de: ${MOTIVOS.join(', ')}` }, { status: 400 })
  }
  const detalle = (body.message ?? '').trim().slice(0, 1000)
  if (!detalle) return NextResponse.json({ error: 'Falta el detalle de lo que pide el cliente' }, { status: 400 })

  const db = createAdminClient()
  // El equipo en modo lectura no se escala a sí mismo.
  if (await rejectTeamActor(db, body.businessId, phone)) {
    return NextResponse.json({ error: 'El equipo no escala conversaciones desde el agente' }, { status: 403 })
  }

  const { data: business } = await db.from('businesses')
    .select('id,name,phone').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  const { data: client } = await db.from('clients')
    .select('id,full_name').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()

  const canal = body.channel === 'INSTAGRAM' || body.channel === 'MESSENGER' ? body.channel : 'WHATSAPP'
  const { conversationId, yaEstaba } = await escalarHilo(db, {
    businessId: body.businessId,
    clientId: client?.id ?? null,
    channel: canal,
    externalId: phone,
    motivo,
    detalle,
  })
  if (!conversationId) {
    registrar('error', 'agent_escalate_sin_hilo', { businessId: body.businessId, motivo })
    return NextResponse.json({ escalated: false, error: 'No se pudo abrir el aviso' }, { status: 500 })
  }

  const { data: equipo } = await db.from('business_members')
    .select('user_id,role').eq('business_id', body.businessId).eq('active', true).in('role', ROLES_QUE_ATIENDEN)

  const destinatarios = (equipo ?? []).map((item) => item.user_id).filter(Boolean)
  if (!destinatarios.length) {
    // Sin nadie a quien avisar, decirlo. El hilo queda igualmente en HUMAN para que se vea en
    // el panel, pero el agente NO puede prometerle al cliente que alguien lo va a contactar.
    registrar('aviso', 'agent_escalate_sin_equipo', { businessId: body.businessId, motivo })
    return NextResponse.json({
      escalated: false,
      reason: 'sin_equipo',
      businessPhone: business.phone ?? null,
      conversationId,
    })
  }

  const eventKey = `escalacion:${conversationId}:${motivo}`

  /*
   * Quién ya tiene este aviso.
   *
   * La unicidad `(recipient_user_id, event_key)` de la tabla es la guarda contra la carrera,
   * pero no basta por sí sola: sirve para no duplicar, no para saber si hacía falta insertar.
   * Consultando antes, un cliente que insiste tres veces genera un aviso y no tres, y la
   * respuesta puede decir `alreadyDone` con datos y no por suposición.
   */
  const { data: yaAvisados } = await db.from('team_notifications')
    .select('recipient_user_id').eq('event_key', eventKey).in('recipient_user_id', destinatarios)
  const conAviso = new Set((yaAvisados ?? []).map((item) => item.recipient_user_id))
  const pendientes = destinatarios.filter((userId) => !conAviso.has(userId))

  const quien = client?.full_name ? `${client.full_name} (${phone})` : phone
  const filas = pendientes.map((userId) => ({
    business_id: body.businessId,
    recipient_user_id: userId,
    event_key: eventKey,
    kind: 'ESCALATION',
    title: TITULO[motivo].slice(0, 160),
    body: `${quien}: ${detalle}`.slice(0, 1000),
    payload: { conversationId, phone, motivo, clientId: client?.id ?? null },
  }))

  if (filas.length) {
    // `ignoreDuplicates` cierra la carrera: si dos reintentos de n8n llegan a la vez, la
    // unicidad de la tabla decide y ninguno falla.
    const { error } = await db.from('team_notifications').upsert(filas, {
      onConflict: 'recipient_user_id,event_key',
      ignoreDuplicates: true,
    })
    if (error) {
      registrar('error', 'agent_escalate_aviso_falla', { businessId: body.businessId, motivo, detalle: error.message })
      return NextResponse.json({ escalated: false, error: 'No se pudo avisar al equipo' }, { status: 500 })
    }
  }

  const repetida = yaEstaba && !filas.length
  registrar('info', 'agent_escalate', {
    businessId: body.businessId, motivo, destinatarios: destinatarios.length, nuevos: filas.length, repetida,
  })
  return NextResponse.json({
    escalated: true,
    alreadyDone: repetida,
    notified: destinatarios.length,
    conversationId,
  })
}
