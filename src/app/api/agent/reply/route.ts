import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { sendWhatsApp } from '@/lib/whatsapp'
import { reunirEvidencia, revisarRespuesta } from '@/lib/agent-reply'
import { guardarRespuestaPendiente, marcarRespuestaEnviada, marcarRespuestaFallida } from '@/lib/agent-reply-delivery'

/**
 * Única puerta de salida del agente hacia el cliente (A5).
 *
 * Antes n8n mandaba el texto del modelo directo a Evolution: sin revisar nada, sin poder
 * detectar un fallo de envío y sin funcionar para los negocios que usan META o 360dialog.
 *
 * Acá se hacen tres cosas, en este orden:
 * 1. Revisar el texto contra lo que DE VERDAD pasó en la base (ver `@/lib/agent-reply`): una
 *    reserva inventada, un volcado técnico o una respuesta vacía no salen nunca.
 * 2. Enviarlo por el proveedor que tenga configurado el negocio.
 * 3. Responder si se entregó o no. Un fallo devuelve 502 para que la ejecución de n8n quede
 *    marcada como fallida y reintente EL MISMO texto (el modelo no vuelve a correr, así que
 *    un reintento no puede producir una segunda reserva).
 */

/** Ventana en la que se busca evidencia de lo que hizo el agente en este turno. */
const VENTANA_MINUTOS = 15

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; reply?: string; instance?: string; messageId?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })

  const db = createAdminClient()
  const { data: business } = await db.from('businesses')
    .select('id,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key')
    .eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  const { data: client } = await db.from('clients').select('id')
    .eq('business_id', body.businessId).eq('phone', phone).maybeSingle()

  const desde = new Date(Date.now() - VENTANA_MINUTOS * 60000).toISOString()
  const evidencia = await reunirEvidencia(db, { businessId: body.businessId, clientId: client?.id ?? null, desde })
  const revision = revisarRespuesta(String(body.reply ?? ''), evidencia)

  // Si el negocio todavía no tiene proveedor guardado, se usa la instancia de Evolution por
  // la que entró el mensaje: es la que venía usando el workflow y no se puede romper.
  const instancia = body.instance?.trim() || null
  const proveedor = {
    ...business,
    whatsapp_provider: business.whatsapp_provider || (instancia ? 'EVOLUTION' : null),
    whatsapp_instance: business.whatsapp_instance || instancia,
  }

  // Se guarda ANTES de mandar: si esta ejecución muere ahora mismo, la respuesta queda
  // pendiente y otra pasada la reintenta tal cual, sin volver a correr el modelo.
  const clave = body.messageId ? { businessId: body.businessId, phone, messageId: body.messageId } : null
  const guardado = clave
    ? await guardarRespuestaPendiente(db, { ...clave, texto: revision.texto })
    : { durable: false, guardada: false }

  const envio = await sendWhatsApp(proveedor, { phone, text: revision.texto })
  const cuerpo = { text: revision.texto, blocked: revision.bloqueada, reasons: revision.motivos, durable: guardado.guardada }

  if (!envio.success) {
    if (clave && guardado.guardada) await marcarRespuestaFallida(db, clave, envio.error ?? 'envio_fallido')
    return NextResponse.json({ sent: false, ...cuerpo, error: envio.error ?? 'envio_fallido' }, { status: 502 })
  }
  if (clave && guardado.guardada) await marcarRespuestaEnviada(db, clave)
  return NextResponse.json({ sent: true, ...cuerpo })
}
