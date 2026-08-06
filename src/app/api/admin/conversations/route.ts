import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const status = new URL(request.url).searchParams.get('status')
    let builder = db.from('conversations').select('id,channel,status,external_id,created_at,updated_at,client:clients(id,full_name,phone)').eq('business_id', businessId).order('updated_at', { ascending: false }).limit(100)
    if (status) builder = builder.eq('status', status)
    const { data: conversations, error } = await builder
    if (error) throw error

    const ids = (conversations ?? []).map((conversation) => conversation.id)
    const previews = new Map<string, { content: string; created_at: string; sender: string }>()
    if (ids.length) {
      const { data: messages, error: messagesError } = await db.from('messages').select('conversation_id,content,sender,created_at').in('conversation_id', ids).order('created_at', { ascending: false }).limit(500)
      if (messagesError) throw messagesError
      for (const message of messages ?? []) if (!previews.has(message.conversation_id)) previews.set(message.conversation_id, { content: message.content, created_at: message.created_at, sender: message.sender })
    }
    return NextResponse.json({ conversations: (conversations ?? []).map((conversation) => ({ ...conversation, last_message: previews.get(conversation.id) ?? null })) })
  } catch (error) { return apiError(error) }
}

/** Pasar la conversación a atención humana (o devolverla al agente / cerrarla). */
export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const body = await request.json() as { id?: string; status?: string }
    if (!body.id || !body.status) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    if (!['OPEN', 'HUMAN', 'CLOSED'].includes(body.status)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    const { data, error } = await db.from('conversations').update({ status: body.status, updated_at: new Date().toISOString() }).eq('id', body.id).eq('business_id', businessId).select('id,status').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Esa conversación no pertenece al negocio' }, { status: 404 })
    return NextResponse.json({ conversation: data })
  } catch (error) { return apiError(error) }
}
