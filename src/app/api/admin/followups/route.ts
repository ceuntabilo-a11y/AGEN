import {NextResponse} from 'next/server'
import {apiError} from '@/lib/http-errors'
import {requireBusinessContext} from '@/lib/supabase-server'

export const dynamic='force-dynamic'

export async function GET(){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    await db.rpc('generate_follow_up_tasks',{p_business_id:businessId})
    const [tasks,waitlist]=await Promise.all([
      db.from('follow_up_tasks').select('id,reason,title,due_on,status,notes,created_at,client:clients(id,full_name,phone),appointment:appointments(id,service_period),quote:quotes(id,total,status)').eq('business_id',businessId).order('due_on').order('created_at'),
      db.from('waitlist_entries').select('id,status,preferred_from,preferred_until,notes,created_at,client:clients(id,full_name,phone),service:services(id,name),professional:professionals(id,display_name,color)').eq('business_id',businessId).order('created_at'),
    ])
    if(tasks.error||waitlist.error)throw tasks.error||waitlist.error
    return NextResponse.json({tasks:tasks.data??[],waitlist:waitlist.data??[]})
  }catch(error){return apiError(error)}
}

export async function POST(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    const body=await request.json() as {kind?:'task'|'waitlist';clientId?:string;serviceId?:string;professionalId?:string;title?:string;notes?:string;preferredFrom?:string;preferredUntil?:string}
    if(!body.clientId)return NextResponse.json({error:'Selecciona un cliente'},{status:400})
    const {data:client}=await db.from('clients').select('id').eq('id',body.clientId).eq('business_id',businessId).maybeSingle()
    if(!client)return NextResponse.json({error:'Cliente inválido'},{status:400})
    if(body.kind==='waitlist'){
      if(!body.serviceId)return NextResponse.json({error:'Selecciona un servicio'},{status:400})
      const {data:service}=await db.from('services').select('id').eq('id',body.serviceId).eq('business_id',businessId).eq('active',true).maybeSingle()
      if(!service)return NextResponse.json({error:'Servicio inválido'},{status:400})
      if(body.professionalId){
        const {data:professional}=await db.from('professional_services').select('professional:professionals!inner(id,business_id,active)').eq('professional_id',body.professionalId).eq('service_id',body.serviceId).eq('active',true).maybeSingle()
        const linked=Array.isArray(professional?.professional)?professional.professional[0]:professional?.professional
        if(!linked||linked.business_id!==businessId||!linked.active)return NextResponse.json({error:'El profesional no realiza ese servicio'},{status:400})
      }
      const {data,error}=await db.from('waitlist_entries').insert({business_id:businessId,client_id:body.clientId,service_id:body.serviceId,professional_id:body.professionalId||null,preferred_from:body.preferredFrom||null,preferred_until:body.preferredUntil||null,notes:body.notes?.trim()||null}).select().single()
      if(error)throw error
      return NextResponse.json({entry:data},{status:201})
    }
    const {data,error}=await db.from('follow_up_tasks').insert({business_id:businessId,client_id:body.clientId,reason:'MANUAL',title:(body.title?.trim()||'Contactar al cliente').slice(0,160),notes:body.notes?.trim().slice(0,1000)||null,due_on:new Date().toISOString().slice(0,10)}).select().single()
    if(error)throw error
    return NextResponse.json({task:data},{status:201})
  }catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    const body=await request.json() as {kind?:'task'|'waitlist';id?:string;status?:string}
    if(!body.id||!body.status)return NextResponse.json({error:'Datos incompletos'},{status:400})
    if(body.kind==='waitlist'){
      if(!['WAITING','CONTACTED','BOOKED','CANCELLED'].includes(body.status))return NextResponse.json({error:'Estado inválido'},{status:400})
      const {error}=await db.from('waitlist_entries').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',body.id).eq('business_id',businessId)
      if(error)throw error
    }else{
      if(!['PENDING','DONE','DISMISSED'].includes(body.status))return NextResponse.json({error:'Estado inválido'},{status:400})
      const {error}=await db.from('follow_up_tasks').update({status:body.status,completed_at:body.status==='PENDING'?null:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',body.id).eq('business_id',businessId)
      if(error)throw error
    }
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
