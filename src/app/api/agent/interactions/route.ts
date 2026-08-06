import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'

const CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'WEB', 'EMAIL']

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error:'No autorizado' }, { status:401 })
  const body = await request.json() as { businessId?:string; phone?:string; message?:string; reply?:string; channel?:string; externalId?:string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.message || !body.reply) return NextResponse.json({ stored:false, reason:'Datos incompletos' })
  const channel = body.channel && CHANNELS.includes(body.channel) ? body.channel : 'WHATSAPP'
  const db = createAdminClient()
  const { data:client } = await db.from('clients').select('id').eq('business_id',body.businessId).eq('phone',phone).maybeSingle()
  if (!client) return NextResponse.json({ stored:false, reason:'Cliente todavía no registrado' })

  const message = body.message.trim().slice(0,1000)
  const reply = body.reply.trim().slice(0,1500)

  const { data:memory } = await db.from('client_memory').select('conversation_summary,known_facts,preferences,last_intent').eq('client_id',client.id).maybeSingle()
  const interaction = `Cliente: ${message}\nAgen: ${reply}`
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

  // Además del resumen, el hilo queda guardado mensaje a mensaje para poder leerlo en Conversaciones.
  let conversationId: string | null = null
  try {
    const { data:open } = await db.from('conversations').select('id').eq('business_id',body.businessId).eq('client_id',client.id).eq('channel',channel).neq('status','CLOSED').order('updated_at',{ascending:false}).limit(1).maybeSingle()
    conversationId = open?.id ?? null
    if (!conversationId) {
      const { data:created } = await db.from('conversations').insert({ business_id:body.businessId, client_id:client.id, channel, external_id:body.externalId ?? phone, status:'OPEN' }).select('id').single()
      conversationId = created?.id ?? null
    }
    if (conversationId) {
      await db.from('messages').insert([
        { conversation_id:conversationId, direction:'INBOUND', sender:'CLIENT', content:message },
        { conversation_id:conversationId, direction:'OUTBOUND', sender:'AI', content:reply },
      ])
      await db.from('conversations').update({ updated_at:new Date().toISOString() }).eq('id',conversationId)
    }
  } catch { /* la memoria ya quedó guardada: archivar el hilo nunca puede tumbar la respuesta del agente */ }

  return NextResponse.json({ stored:true, clientId:client.id, conversationId })
}
