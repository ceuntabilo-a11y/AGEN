import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import {rejectTeamActor} from '@/lib/agent-actor'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; fullName?: string; email?: string; marketingOptIn?: boolean }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })

  const db = createAdminClient()
  if(await rejectTeamActor(db,body.businessId,phone))return NextResponse.json({error:'El equipo no puede registrarse como cliente desde el agente'},{status:403})
  const { data: business } = await db.from('businesses').select('id').eq('id',body.businessId).eq('active',true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  const { data: existing, error: lookupError } = await db.from('clients').select('id,full_name,phone,email,marketing_opt_in').eq('business_id',body.businessId).eq('phone',phone).maybeSingle()
  if (lookupError) return NextResponse.json({ error: 'No se pudo consultar el cliente' }, { status: 500 })

  if (existing) {
    const changes: Record<string, unknown> = {}
    if (body.fullName?.trim() && body.fullName.trim() !== existing.full_name) changes.full_name = body.fullName.trim()
    if (body.email?.trim() && body.email.trim().toLowerCase() !== existing.email) changes.email = body.email.trim().toLowerCase()
    if (body.marketingOptIn === true && !existing.marketing_opt_in) changes.marketing_opt_in = true
    if (Object.keys(changes).length) await db.from('clients').update({ ...changes, updated_at: new Date().toISOString() }).eq('id',existing.id).eq('business_id',body.businessId)
    return NextResponse.json({ created: false, client: { ...existing, ...changes } })
  }

  if (!body.fullName?.trim()) return NextResponse.json({ error: 'Se necesita el nombre antes de registrar al cliente', needsName: true }, { status: 409 })
  const { data: client, error } = await db.from('clients').insert({
    business_id: body.businessId,
    full_name: body.fullName.trim().slice(0,200),
    phone,
    email: body.email?.trim().toLowerCase() || null,
    marketing_opt_in: body.marketingOptIn === true,
  }).select('id,full_name,phone,email,marketing_opt_in').single()
  if (error?.code === '23505') {
    const { data: concurrent } = await db.from('clients').select('id,full_name,phone,email,marketing_opt_in').eq('business_id',body.businessId).eq('phone',phone).single()
    return NextResponse.json({ created: false, client: concurrent })
  }
  if (error) return NextResponse.json({ error: 'No se pudo registrar el cliente' }, { status: 500 })

  if (body.marketingOptIn === true) {
    const channels = ['WHATSAPP', ...(client.email ? ['EMAIL'] : [])]
    await db.from('communication_consents').insert(channels.map((channel) => ({ client_id: client.id, channel, purpose: 'MARKETING', granted: true, source: 'AI_AGENT' })))
  }
  return NextResponse.json({ created: true, client }, { status: 201 })
}
