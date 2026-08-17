import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { describirMedia } from '@/lib/agent-media'

/**
 * Transcribe una nota de voz o describe una imagen del cliente.
 *
 * La lógica vive en `@/lib/agent-media` porque ahora la usan dos caminos: esta ruta (que el
 * workflow puede seguir llamando) y `/api/agent/turn`, que la ejecuta dentro del mismo turno
 * para no gastar un viaje de ida y vuelta más.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { businessId?: string; mediaType?: 'image' | 'audio' | null; mediaUrl?: string | null }
  if (!body.businessId || !body.mediaType || !body.mediaUrl) return NextResponse.json({ text: null })

  const media = await describirMedia(createAdminClient(), {
    businessId: body.businessId, mediaType: body.mediaType, mediaUrl: body.mediaUrl,
  })

  // Capacidad apagada: el agente tiene que enterarse de que llegó algo, o contesta como si el
  // cliente no hubiera mandado nada.
  if (media.motivo === 'desactivada') {
    return NextResponse.json({
      text: body.mediaType === 'image'
        ? '(el cliente envió una imagen, pero esta función está desactivada)'
        : '(el cliente envió una nota de voz, pero esta función está desactivada)',
    })
  }

  return NextResponse.json({ text: media.texto })
}
