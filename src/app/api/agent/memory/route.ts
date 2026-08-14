import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'
import {dateKeyInZone,formatInZone,formatTimeInZone,zonedDayRange} from '@/lib/timezone'
import {findAgentTeamActor,rejectTeamActor} from '@/lib/agent-actor'
import { saveAgentMemory } from '@/lib/client-memory'

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

  // Las reservas vigentes viajan siempre en el contexto: sin esto el agente adivinaba y le
  // preguntaba "¿confirmas tu cita?" a gente que nunca había reservado.
  let appointments: Array<Record<string, unknown>> = []
  if (data) {
    const { data: business } = await db.from('businesses').select('timezone').eq('id', body.businessId).maybeSingle()
    const timezone = business?.timezone || 'America/Santiago'
    const { data: upcoming } = await db.from('appointments')
      .select('id,status,service_period,client_confirmed_at,professional:professionals(display_name),service:services(name)')
      .eq('business_id', body.businessId).eq('client_id', data.id)
      .in('status', ['PENDING', 'CONFIRMED'])
      .overlaps('service_period', `[${new Date().toISOString()},${new Date(Date.now() + 90 * 86400000).toISOString()})`)
      .order('service_period').limit(5)
    appointments = (upcoming ?? []).map((item: any) => {
      const start = String(item.service_period).replace(/[[\]()"]/g, '').split(',')[0]
      return {
        appointmentId: item.id,
        status: item.status,
        confirmedByClient: Boolean(item.client_confirmed_at),
        date: formatInZone(start, timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
        time: formatTimeInZone(start, timezone),
        serviceName: item.service?.name ?? null,
        professionalName: item.professional?.display_name ?? null,
      }
    })
  }
  return NextResponse.json({ known: Boolean(data), actorType:'CLIENT', client: data, appointments })
}

export async function PUT(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; clientId?: string; actorPhone?: string; summary?: string; lastIntent?: string; knownFacts?: Record<string, unknown>; preferences?: Record<string, unknown> }
  if (!body.businessId || !body.clientId || !body.actorPhone) return NextResponse.json({ error: 'businessId, clientId y actorPhone son obligatorios' }, { status: 400 })
  const db = createAdminClient()
  if(await rejectTeamActor(db,body.businessId,body.actorPhone))return NextResponse.json({error:'El equipo solo puede consultar desde el agente'},{status:403})
  const { data: client } = await db.from('clients').select('id').eq('id',body.clientId).eq('business_id',body.businessId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Cliente inexistente' }, { status: 404 })
  // Único escritor del contenido de la memoria (ver `@/lib/client-memory`).
  const guardada = await saveAgentMemory(db, {
    clientId: body.clientId,
    summary: body.summary,
    lastIntent: body.lastIntent,
    knownFacts: body.knownFacts,
    preferences: body.preferences,
  })
  if (!guardada) return NextResponse.json({ error: 'No se pudo actualizar la memoria' }, { status: 500 })
  return NextResponse.json({ updated: true })
}
