import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'

/**
 * Agrupa los mensajes que un cliente manda seguidos para que el agente conteste una sola vez.
 * POST registra el mensaje que acaba de llegar. PUT pregunta, tras una pausa corta, si esta
 * conversación es la última: solo esa responde, y recibe todos los mensajes juntos.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; messageId?: string; content?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.messageId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  const db = createAdminClient()
  const { error } = await db.from('agent_inbox').upsert({
    business_id: body.businessId,
    phone,
    message_id: body.messageId.slice(0, 120),
    content: (body.content ?? '').slice(0, 2000),
  }, { onConflict: 'business_id,phone,message_id' })
  if (error) return NextResponse.json({ registered: false }, { status: 500 })
  return NextResponse.json({ registered: true })
}

export async function PUT(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; messageId?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.messageId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
  const db = createAdminClient()

  const { data: pending, error } = await db.from('agent_inbox')
    .select('id,message_id,content')
    .eq('business_id', body.businessId).eq('phone', phone).is('consumed_at', null)
    .order('created_at').order('id').limit(20)
  if (error) return NextResponse.json({ claim: false }, { status: 500 })

  const rows = pending ?? []
  const last = rows[rows.length - 1]
  // Si ya llegó un mensaje posterior, esta ejecución se calla: la del último contesta por todas.
  if (!last || last.message_id !== body.messageId) return NextResponse.json({ claim: false })

  const { error: consumeError } = await db.from('agent_inbox')
    .update({ consumed_at: new Date().toISOString() })
    .in('id', rows.map((row) => row.id))
  if (consumeError) return NextResponse.json({ claim: false }, { status: 500 })

  const message = rows.map((row) => row.content).filter(Boolean).join('\n')
  return NextResponse.json({ claim: true, message })
}
