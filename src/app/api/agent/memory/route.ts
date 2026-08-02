import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone) return NextResponse.json({ error: 'businessId y phone son obligatorios' }, { status: 400 })
  const db = createAdminClient()
  const { data, error } = await db.from('clients').select('id,full_name,phone,email,birthday,notes,marketing_opt_in,client_memory(preferred_professional_id,preferred_service_id,preferences,known_facts,conversation_summary,last_intent,last_interaction_at)').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo consultar la memoria' }, { status: 500 })
  return NextResponse.json({ known: Boolean(data), client: data })
}

export async function PUT(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; clientId?: string; summary?: string; lastIntent?: string; knownFacts?: Record<string, unknown>; preferences?: Record<string, unknown> }
  if (!body.businessId || !body.clientId) return NextResponse.json({ error: 'businessId y clientId son obligatorios' }, { status: 400 })
  const db = createAdminClient()
  const { data: client } = await db.from('clients').select('id').eq('id',body.clientId).eq('business_id',body.businessId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Cliente inexistente' }, { status: 404 })
  const { data: existing } = await db.from('client_memory').select('conversation_summary,last_intent,known_facts,preferences').eq('client_id',body.clientId).maybeSingle()
  const { error } = await db.from('client_memory').upsert({ client_id: body.clientId, conversation_summary: body.summary?.slice(0, 4000) ?? existing?.conversation_summary ?? null, last_intent: body.lastIntent?.slice(0, 100) ?? existing?.last_intent ?? null, known_facts: { ...(existing?.known_facts ?? {}), ...(body.knownFacts ?? {}) }, preferences: { ...(existing?.preferences ?? {}), ...(body.preferences ?? {}) }, last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la memoria' }, { status: 500 })
  return NextResponse.json({ updated: true })
}
