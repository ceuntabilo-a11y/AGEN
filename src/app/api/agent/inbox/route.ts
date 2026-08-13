import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'
import { claimInboxGroup, registerInboxMessage } from '@/lib/agent-inbox'

/**
 * Agrupa los mensajes que un cliente manda seguidos para que el agente conteste una sola vez.
 * POST registra el mensaje que acaba de llegar. PUT pregunta, tras una pausa corta, si esta
 * conversación es la última: solo esa responde, y recibe todos los mensajes juntos.
 *
 * La lógica del reclamo está en `@/lib/agent-inbox` para poder probarla con dos ejecuciones
 * concurrentes (webhook duplicado, reintento de n8n) y comprobar que solo una contesta.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; messageId?: string; content?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.messageId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  const registered = await registerInboxMessage(createAdminClient(), {
    businessId: body.businessId,
    phone,
    messageId: body.messageId,
    content: body.content ?? '',
  })
  if (!registered) return NextResponse.json({ registered: false }, { status: 500 })
  return NextResponse.json({ registered: true })
}

export async function PUT(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; messageId?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.messageId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

  const resultado = await claimInboxGroup(createAdminClient(), { businessId: body.businessId, phone, messageId: body.messageId })
  if (resultado.fallo) return NextResponse.json({ claim: false }, { status: 500 })
  return NextResponse.json(resultado.claim ? { claim: true, message: resultado.message } : { claim: false })
}
