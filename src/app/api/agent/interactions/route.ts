import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error:'No autorizado' }, { status:401 })
  const body = await request.json() as { businessId?:string; phone?:string; message?:string; reply?:string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.message || !body.reply) return NextResponse.json({ stored:false, reason:'Datos incompletos' })
  const db = createAdminClient()
  const { data:client } = await db.from('clients').select('id').eq('business_id',body.businessId).eq('phone',phone).maybeSingle()
  if (!client) return NextResponse.json({ stored:false, reason:'Cliente todavía no registrado' })
  const { data:memory } = await db.from('client_memory').select('conversation_summary,known_facts,preferences,last_intent').eq('client_id',client.id).maybeSingle()
  const interaction = `Cliente: ${body.message.trim().slice(0,1000)}\nAgen: ${body.reply.trim().slice(0,1500)}`
  const summary = [memory?.conversation_summary,interaction].filter(Boolean).join('\n').slice(-4000)
  const { error } = await db.from('client_memory').upsert({
    client_id:client.id,
    conversation_summary:summary,
    known_facts:memory?.known_facts??{},
    preferences:memory?.preferences??{},
    last_intent:memory?.last_intent??null,
    last_interaction_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  })
  if (error) return NextResponse.json({ stored:false }, { status:500 })
  return NextResponse.json({ stored:true, clientId:client.id })
}
