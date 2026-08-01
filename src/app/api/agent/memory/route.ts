import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string }
  if (!body.businessId || !body.phone) return NextResponse.json({ error: 'businessId y phone son obligatorios' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('clients').select('id,full_name,phone,email,birthday,notes,marketing_opt_in,client_memory(preferred_professional_id,preferred_service_id,preferences,known_facts,conversation_summary,last_intent,last_interaction_at)').eq('business_id', body.businessId).eq('phone', body.phone).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo consultar la memoria' }, { status: 500 })
  return NextResponse.json({ known: Boolean(data), client: data })
}

export async function PUT(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { clientId?: string; summary?: string; lastIntent?: string; knownFacts?: Record<string, unknown>; preferences?: Record<string, unknown> }
  if (!body.clientId) return NextResponse.json({ error: 'clientId es obligatorio' }, { status: 400 })
  const { error } = await createAdminClient().from('client_memory').upsert({ client_id: body.clientId, conversation_summary: body.summary?.slice(0, 4000), last_intent: body.lastIntent?.slice(0, 100), known_facts: body.knownFacts ?? {}, preferences: body.preferences ?? {}, last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la memoria' }, { status: 500 })
  return NextResponse.json({ updated: true })
}
