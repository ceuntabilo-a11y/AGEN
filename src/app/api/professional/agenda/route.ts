import { NextResponse } from 'next/server'
import { readAvailability } from '@/lib/availability'
import { loadBusinessHours } from '@/lib/business-hours'
import { apiError } from '@/lib/http-errors'
import { requireProfessionalContext } from '@/lib/professional-context'
import { createAdminClient } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

/**
 * Regla de negocio devuelta por Postgres (`P0001`), por ejemplo el horario de atención.
 * El mensaje ya viene en español y escrito para el usuario, así que se muestra tal cual.
 */
function businessRuleResponse(error: { code?: string; message?: string } | null) {
  if (error?.code !== 'P0001') return null
  return NextResponse.json({ error: error.message ?? 'No se puede hacer ese cambio' }, { status: 409 })
}


/** Minutos que dura hoy la reserva, leídos del rango `[inicio,fin)` que devuelve Postgres. */
function currentDurationMinutes(period: unknown) {
  const [start, end] = String(period ?? '').replace(/[[\]()"]/g, '').split(',')
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  return Number.isFinite(minutes) ? minutes : -1
}

export async function GET(request:Request){
  try{
    const {db,businessId,professional}=await requireProfessionalContext()
    const url=new URL(request.url)
    const from=url.searchParams.get('from')??new Date().toISOString()
    const until=url.searchParams.get('until')??new Date(Date.now()+7*86400000).toISOString()
    // El horario propio y el del negocio viajan con la agenda a propósito: el calendario los
    // necesita para dibujar la jornada, los descansos y los días cerrados, y pedirlos en una
    // llamada aparte obligaría a la pantalla a esperar dos veces para poder pintar una sola vez.
    const [appointments,business,blocks,availability,businessHours]=await Promise.all([
      db.from('appointments').select('id,status,service_period,quoted_price,deposit_paid,notes,client_confirmed_at,client:clients(id,full_name,phone,notes),service:services(id,name,duration_minutes)').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('service_period',`[${from},${until})`).order('service_period'),
      db.from('businesses').select('timezone').eq('id',businessId).single(),
      db.from('schedule_blocks').select('id,period,reason').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('period',`[${from},${until})`).order('period').limit(100),
      readAvailability(db,professional.id),
      loadBusinessHours(db,businessId),
    ])
    if(appointments.error||business.error||blocks.error)throw appointments.error||business.error||blocks.error
    return NextResponse.json({professional,appointments:appointments.data,blocks:blocks.data,timezone:business.data.timezone,availability,businessHours})
  }catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const {db,businessId,professional}=await requireProfessionalContext()
    const body=await request.json() as {
      appointmentId?:string
      action?:'status'|'cancel'|'reschedule'|'resize'
      status?:string
      newStart?:string
      durationMinutes?:number
      reason?:string
      notify?:boolean
    }
    const action=body.action??'status'
    if(!body.appointmentId)return NextResponse.json({error:'Cambio inválido'},{status:400})

    const {data:current,error:currentError}=await db.from('appointments').select('id,status,notes,service_period').eq('id',body.appointmentId).eq('business_id',businessId).eq('professional_id',professional.id).maybeSingle()
    if(currentError)throw currentError
    if(!current)return NextResponse.json({error:'Reserva inexistente'},{status:404})

    // Igual que en el panel del negocio: cualquier cambio se le explica al cliente por WhatsApp.
    const CHANGE_ACTIONS=['cancel','reschedule','resize']
    const reason=body.reason?.trim().slice(0,300)??''
    if(CHANGE_ACTIONS.includes(action)&&!reason)return NextResponse.json({error:'Escribe el motivo del cambio: se le explicará al cliente'},{status:400})

    if(action==='cancel'){
      if(current.status==='CANCELLED')return NextResponse.json({appointment:current})
      const {data,error}=await db.rpc('cancel_safe_appointment',{p_appointment_id:body.appointmentId,p_reason:reason,p_actor:professional.display_name})
      if(error)throw error
      await db.from('appointments').update({notes:[current.notes,`Cancelación: ${reason}`].filter(Boolean).join('\n').slice(0,1000)}).eq('id',body.appointmentId).eq('business_id',businessId)
      return NextResponse.json({appointment:data})
    }

    if(action==='reschedule'){
      const newStart=body.newStart?new Date(body.newStart):null
      if(!newStart||Number.isNaN(newStart.getTime()))return NextResponse.json({error:'Nueva fecha inválida'},{status:400})
      const {data,error}=await db.rpc('reschedule_safe_appointment',{p_appointment_id:body.appointmentId,p_new_start:newStart.toISOString(),p_reason:reason,p_actor:professional.display_name})
      const rule = businessRuleResponse(error); if (rule) return rule
      if(error?.code==='23P01')return NextResponse.json({error:error.message,conflict:true},{status:409})
      if(error)throw error
      return NextResponse.json({appointment:data})
    }

    if(action==='resize'){
      const duration=Math.round(Number(body.durationMinutes))
      if(!Number.isFinite(duration)||duration<5||duration>1440)return NextResponse.json({error:'Duración inválida'},{status:400})
      if(duration===currentDurationMinutes(current.service_period))return NextResponse.json({error:'La duración es la misma: no hay ningún cambio que guardar'},{status:400})
      const {data,error}=await db.rpc('resize_safe_appointment',{p_appointment_id:body.appointmentId,p_duration_minutes:duration,p_reason:reason,p_actor:professional.display_name})
      const rule = businessRuleResponse(error); if (rule) return rule
      if(error?.code==='23P01')return NextResponse.json({error:error.message,conflict:true},{status:409})
      if(error)throw error
      return NextResponse.json({appointment:data})
    }

    if(!body.status)return NextResponse.json({error:'Cambio inválido'},{status:400})
    const transitions:Record<string,string[]>={PENDING:['CONFIRMED','CHECKED_IN','NO_SHOW'],CONFIRMED:['CHECKED_IN','NO_SHOW'],CHECKED_IN:['IN_PROGRESS'],IN_PROGRESS:['COMPLETED']}
    if(!(transitions[current.status]??[]).includes(body.status))return NextResponse.json({error:'Cambio de estado no permitido'},{status:409})
    const {data,error}=await db.from('appointments').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',body.appointmentId).eq('business_id',businessId).eq('professional_id',professional.id).select().single()
    if(error)throw error
    if(body.status==='NO_SHOW'&&body.notify)await createAdminClient().rpc('enqueue_appointment_event',{p_appointment_id:body.appointmentId,p_event_type:'FOLLOW_UP',p_scheduled_at:new Date().toISOString()})
    return NextResponse.json({appointment:data})
  }catch(error){return apiError(error)}
}
