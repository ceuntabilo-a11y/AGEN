import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { vozParaRespuesta } from '@/lib/agent-voz'

/**
 * Voz de la respuesta del agente.
 *
 * La lógica vive en `@/lib/agent-voz` porque ahora la usa `/api/agent/reply`, que es por donde
 * salen todas las respuestas. Esta ruta se conserva para el botón de prueba y para cualquier
 * workflow antiguo que todavía la llame.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ speak: false, sendText: true, reason: 'no_autorizado' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { businessId?: string; text?: string; wasAudio?: boolean; actorType?: string }

  const resultado = await vozParaRespuesta(createAdminClient(), {
    businessId: String(body.businessId ?? ''),
    text: String(body.text ?? ''),
    wasAudio: body.wasAudio,
    actorType: body.actorType,
  })
  return NextResponse.json(resultado)
}
