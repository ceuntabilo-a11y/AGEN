import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    const { data, error } = await db.from('campaigns').select('id,name,channel,audience,content,image_url,status,scheduled_at,sent_at,created_at,campaign_recipients(id,status,reason,sent_at,client:clients(id,full_name,phone,email))').eq('business_id',businessId).order('created_at',{ascending:false})
    if (error) throw error
    return NextResponse.json({ campaigns: data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    const body = await request.json() as { name?: string; channel?: string; audience?: Record<string,unknown>; content?: string; imageUrl?: string|null; scheduledAt?: string|null }
    if (!body.name?.trim() || !body.channel || !body.content?.trim()) return NextResponse.json({ error: 'Nombre, canal y contenido son obligatorios' }, { status: 400 })
    const { data, error } = await db.from('campaigns').insert({ business_id:businessId, name:body.name.trim(), channel:body.channel, audience:body.audience??{}, content:body.content.trim(), image_url:body.imageUrl??null, scheduled_at:body.scheduledAt??null, status:body.scheduledAt?'SCHEDULED':'DRAFT' }).select().single()
    if (error) throw error
    return NextResponse.json({ campaign:data }, { status:201 })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    const body = await request.json() as { campaignId?: string; name?: string; channel?: string; audience?: Record<string,unknown>; content?: string; imageUrl?: string|null; scheduledAt?: string|null }
    if (!body.campaignId || !body.name?.trim() || !body.channel || !body.content?.trim()) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    const { data: current } = await db.from('campaigns').select('id,status').eq('id',body.campaignId).eq('business_id',businessId).maybeSingle()
    if (!current) return NextResponse.json({ error: 'Campaña inexistente' }, { status: 404 })
    if (current.status === 'SENDING') return NextResponse.json({ error: 'No se puede editar mientras se envía' }, { status: 409 })
    const status = body.scheduledAt ? 'SCHEDULED' : current.status === 'SCHEDULED' ? 'DRAFT' : current.status
    const { data, error } = await db.from('campaigns').update({ name:body.name.trim(), channel:body.channel, audience:body.audience??{}, content:body.content.trim(), image_url:body.imageUrl??null, scheduled_at:body.scheduledAt??null, status }).eq('id',body.campaignId).eq('business_id',businessId).select().single()
    if (error) throw error
    return NextResponse.json({ campaign:data })
  } catch (error) { return apiError(error) }
}
