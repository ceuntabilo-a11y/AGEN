import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireProfessionalContext } from '@/lib/professional-context'
import { createAdminClient } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

export async function GET(request:Request){
  try{
    const {db,businessId,professional}=await requireProfessionalContext()
    const url=new URL(request.url)
    const from=url.searchParams.get('from')??new Date().toISOString()
    const until=url.searchParams.get('until')??new Date(Date.now()+7*86400000).toISOString()
    const [appointments,business,blocks]=await Promise.all([
      db.from('appointments').select('id,status,service_period,quoted_price,deposit_paid,notes,client:clients(id,full_name,phone,notes),service:services(id,name,duration_minutes)').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('service_period',`[${from},${until})`).order('service_period'),
      db.from('businesses').select('timezone').eq('id',businessId).single(),
      db.from('schedule_blocks').select('id,period,reason').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('period',`[${from},${until})`).order('period').limit(100),
    ])
    if(appointments.error||business.error||blocks.error)throw appointments.error||business.error||blocks.error
    return NextResponse.json({professional,appointments:appointments.data,blocks:blocks.data,timezone:business.data.timezone})
  }catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const {db,businessId,professional}=await requireProfessionalContext()
    const body=await request.json() as {appointmentId?:string;status?:string;notify?:boolean}
    if(!body.appointmentId||!body.status)return NextResponse.json({error:'Cambio inválido'},{status:400})
    const {data:current,error:currentError}=await db.from('appointments').select('id,status').eq('id',body.appointmentId).eq('business_id',businessId).eq('professional_id',professional.id).maybeSingle()
    if(currentError)throw currentError
    if(!current)return NextResponse.json({error:'Reserva inexistente'},{status:404})
    const transitions:Record<string,string[]>={PENDING:['CONFIRMED','CHECKED_IN','NO_SHOW'],CONFIRMED:['CHECKED_IN','NO_SHOW'],CHECKED_IN:['IN_PROGRESS'],IN_PROGRESS:['COMPLETED']}
    if(!(transitions[current.status]??[]).includes(body.status))return NextResponse.json({error:'Cambio de estado no permitido'},{status:409})
    const {data,error}=await db.from('appointments').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',body.appointmentId).eq('business_id',businessId).eq('professional_id',professional.id).select().single()
    if(error)throw error
    if(body.status==='NO_SHOW'&&body.notify)await createAdminClient().rpc('enqueue_appointment_event',{p_appointment_id:body.appointmentId,p_event_type:'FOLLOW_UP',p_scheduled_at:new Date().toISOString()})
    return NextResponse.json({appointment:data})
  }catch(error){return apiError(error)}
}
