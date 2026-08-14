import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import {
  marcarRespuestaEnviada,
  marcarRespuestaFallida,
  reclamarRespuestasPendientes,
} from '@/lib/agent-reply-delivery'

/**
 * Rescate de las respuestas del agente que quedaron sin entregar.
 *
 * Lo llama el workflow de automatización cada pocos minutos. Reintenta EXACTAMENTE el texto
 * que ya había sido validado y guardado por `/api/agent/reply`: no vuelve a correr el modelo,
 * no llama ninguna tool y no puede crear, cancelar ni modificar nada. Solo reenvía.
 *
 * Cada respuesta se reclama de forma exclusiva, así que dos pasadas simultáneas no pueden
 * mandar el mismo mensaje dos veces.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const db = createAdminClient()

  const { durable, respuestas } = await reclamarRespuestasPendientes(db, { limite: 20 })
  if (!durable) {
    // La migración 20260813000001 todavía no está aplicada: no hay nada que rescatar.
    return NextResponse.json({ durable: false, sent: 0, failed: 0 })
  }
  if (!respuestas.length) return NextResponse.json({ durable: true, sent: 0, failed: 0 })

  const negocios = new Map<string, any>()
  let sent = 0
  let failed = 0

  for (const pendiente of respuestas) {
    if (!negocios.has(pendiente.business_id)) {
      const { data } = await db.from('businesses')
        .select('id,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key')
        .eq('id', pendiente.business_id).eq('active', true).maybeSingle()
      negocios.set(pendiente.business_id, data ?? null)
    }
    const negocio = negocios.get(pendiente.business_id)
    const clave = { businessId: pendiente.business_id, phone: pendiente.phone, messageId: pendiente.message_id }

    if (!negocio) {
      failed += 1
      await marcarRespuestaFallida(db, clave, 'negocio_inactivo')
      continue
    }

    const envio = await sendWhatsApp(negocio, { phone: pendiente.phone, text: pendiente.reply_text })
    if (envio.success) {
      sent += 1
      await marcarRespuestaEnviada(db, clave)
    } else {
      failed += 1
      await marcarRespuestaFallida(db, clave, envio.error ?? 'envio_fallido')
    }
  }

  return NextResponse.json({ durable: true, sent, failed })
}
