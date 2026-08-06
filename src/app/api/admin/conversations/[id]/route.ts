import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const { id } = await params
    const { data: conversation, error } = await db.from('conversations').select('id,channel,status,external_id,created_at,updated_at,client:clients(id,full_name,phone,email)').eq('business_id', businessId).eq('id', id).maybeSingle()
    if (error) throw error
    if (!conversation) return NextResponse.json({ error: 'Esa conversación no pertenece al negocio' }, { status: 404 })
    const { data: messages, error: messagesError } = await db.from('messages').select('id,direction,sender,content,created_at').eq('conversation_id', id).order('created_at').limit(300)
    if (messagesError) throw messagesError
    const { data: business } = await db.from('businesses').select('timezone').eq('id', businessId).single()
    return NextResponse.json({ conversation, messages: messages ?? [], timezone: business?.timezone ?? 'America/Santiago' })
  } catch (error) { return apiError(error) }
}
