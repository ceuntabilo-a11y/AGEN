import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'
import {dateKeyInZone,zonedDayRange} from '@/lib/timezone'
import {findAgentTeamActor,rejectTeamActor} from '@/lib/agent-actor'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone) return NextResponse.json({ error: 'businessId y phone son obligatorios' }, { status: 400 })
  const db = createAdminClient()
  const actor=await findAgentTeamActor(db,body.businessId,phone)
  if(actor){
    const {data:business}=await db.from('businesses').select('timezone').eq('id',body.businessId).eq('active',true).maybeSingle()
    const timezone=business?.timezone||'America/Santiago',day=dateKeyInZone(new Date(),timezone),{from,until}=zonedDayRange(day,timezone)
    let schedule=db.from('appointments').select('id,status,service_period,client:clients(full_name,phone),professional:professionals(display_name),service:services(name)').eq('business_id',body.businessId).overlaps('service_period',`[${from},${until})`).not('status','eq','CANCELLED').order('service_period')
    if(actor.professionalId)schedule=schedule.eq('professional_id',actor.professionalId)
    const [{data:appointments,error:scheduleError},{count:waiting,error:waitingError},{count:followups,error:followupsError}]=await Promise.all([
      schedule,
      db.from('waitlist_entries').select('id',{count:'exact',head:true}).eq('business_id',body.businessId).eq('status','WAITING'),
      db.from('follow_up_tasks').select('id',{count:'exact',head:true}).eq('business_id',body.businessId).eq('status','PENDING').lte('due_on',day),
    ])
    if(scheduleError||waitingError||followupsError)return NextResponse.json({error:'No se pudo consultar la agenda del equipo'},{status:500})
    return NextResponse.json({known:true,actorType:'TEAM',teamMember:actor,today:appointments??[],waiting:waiting??0,followups:followups??0,timezone})
  }
  const { data, error } = await db.from('clients').select('id,full_name,phone,email,birthday,notes,marketing_opt_in,client_memory(preferred_professional_id,preferred_service_id,preferences,known_facts,conversation_summary,last_intent,last_interaction_at)').eq('business_id', body.businessId).eq('phone', phone).maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo consultar la memoria' }, { status: 500 })
  return NextResponse.json({ known: Boolean(data), actorType:'CLIENT',client: data })
}

export async function PUT(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; clientId?: string; actorPhone?: string; summary?: string; lastIntent?: string; knownFacts?: Record<string, unknown>; preferences?: Record<string, unknown> }
  if (!body.businessId || !body.clientId || !body.actorPhone) return NextResponse.json({ error: 'businessId, clientId y actorPhone son obligatorios' }, { status: 400 })
  const db = createAdminClient()
  if(await rejectTeamActor(db,body.businessId,body.actorPhone))return NextResponse.json({error:'El equipo solo puede consultar desde el agente'},{status:403})
  const { data: client } = await db.from('clients').select('id').eq('id',body.clientId).eq('business_id',body.businessId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Cliente inexistente' }, { status: 404 })
  const { data: existing } = await db.from('client_memory').select('conversation_summary,last_intent,known_facts,preferences').eq('client_id',body.clientId).maybeSingle()
  const { error } = await db.from('client_memory').upsert({ client_id: body.clientId, conversation_summary: body.summary?.slice(0, 4000) ?? existing?.conversation_summary ?? null, last_intent: body.lastIntent?.slice(0, 100) ?? existing?.last_intent ?? null, known_facts: { ...(existing?.known_facts ?? {}), ...(body.knownFacts ?? {}) }, preferences: { ...(existing?.preferences ?? {}), ...(body.preferences ?? {}) }, last_interaction_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la memoria' }, { status: 500 })
  return NextResponse.json({ updated: true })
}
