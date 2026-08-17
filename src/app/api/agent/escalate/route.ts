import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { rejectTeamActor } from '@/lib/agent-actor'
import { escalarConAviso, MOTIVOS_ESCALACION, type MotivoEscalacion } from '@/lib/agent-escalation'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Avisar a una persona del equipo. De verdad.
 *
 * El bug que cierra: el agente ofrecía "¿quieres que avise al equipo?" y, dijera el cliente lo
 * que dijera, no ocurría nada. La lógica vive ahora en `@/lib/agent-escalation` porque también
 * la usa el ejecutor fijo `/api/agent/act`; el comportamiento no cambió.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json() as {
    businessId?: string; phone?: string; reason?: string; message?: string; channel?: string
  }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) {
    return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })
  }
  const motivo = MOTIVOS_ESCALACION.includes(body.reason as MotivoEscalacion) ? body.reason as MotivoEscalacion : null
  if (!motivo) {
    return NextResponse.json({ error: `Motivo inválido. Usa uno de: ${MOTIVOS_ESCALACION.join(', ')}` }, { status: 400 })
  }
  const detalle = (body.message ?? '').trim().slice(0, 1000)
  if (!detalle) return NextResponse.json({ error: 'Falta el detalle de lo que pide el cliente' }, { status: 400 })

  const db = createAdminClient()
  if (await rejectTeamActor(db, body.businessId, phone)) {
    return NextResponse.json({ error: 'El equipo no escala conversaciones desde el agente' }, { status: 403 })
  }

  const { data: business } = await db.from('businesses')
    .select('id,name,phone').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  const { data: client } = await db.from('clients')
    .select('id,full_name').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()

  const resultado = await escalarConAviso(db, {
    businessId: body.businessId,
    phone,
    motivo,
    detalle,
    channel: body.channel,
    businessPhone: business.phone ?? null,
    clientId: client?.id ?? null,
    clientName: client?.full_name ?? null,
  })

  if (resultado.estado) {
    return NextResponse.json({ escalated: false, error: resultado.error }, { status: resultado.estado })
  }
  if (!resultado.escalated) {
    return NextResponse.json({
      escalated: false,
      reason: resultado.reason,
      businessPhone: resultado.businessPhone ?? null,
      conversationId: resultado.conversationId,
    })
  }
  return NextResponse.json({
    escalated: true,
    alreadyDone: resultado.alreadyDone,
    notified: resultado.notified,
    conversationId: resultado.conversationId,
  })
}
