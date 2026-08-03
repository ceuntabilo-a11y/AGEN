import {NextResponse} from 'next/server'
import {apiError} from '@/lib/http-errors'
import {requireBusinessContext} from '@/lib/supabase-server'
import {dateKeyInZone,zonedDayRange} from '@/lib/timezone'

export async function POST(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    const body=await request.json().catch(()=>({})) as {question?:string}
    const question=body.question?.trim().slice(0,300)
    if(!question)return NextResponse.json({error:'Escribe una pregunta'},{status:400})
    const {data:business,error:businessError}=await db.from('businesses').select('timezone,currency').eq('id',businessId).single()
    if(businessError)throw businessError
    const day=dateKeyInZone(new Date(),business.timezone),{from,until}=zonedDayRange(day,business.timezone)
    const [appointments,followups,waitlist,clients,professionals,services,payments]=await Promise.all([
      db.from('appointments').select('id,status').eq('business_id',businessId).overlaps('service_period',`[${from},${until})`).not('status','eq','CANCELLED'),
      db.from('follow_up_tasks').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('status','PENDING').lte('due_on',day),
      db.from('waitlist_entries').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('status','WAITING'),
      db.from('clients').select('id',{count:'exact',head:true}).eq('business_id',businessId),
      db.from('professionals').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('active',true),
      db.from('services').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('active',true),
      db.from('payments').select('amount').eq('business_id',businessId).eq('status','PAID').gte('paid_at',from).lt('paid_at',until),
    ])
    const failed=[appointments,followups,waitlist,clients,professionals,services,payments].find(result=>result.error)
    if(failed?.error)throw failed.error
    const rows=appointments.data??[],confirmed=rows.filter(item=>item.status==='CONFIRMED').length,pending=rows.filter(item=>item.status==='PENDING').length
    const revenue=(payments.data??[]).reduce((sum,item)=>sum+Number(item.amount),0)
    const money=new Intl.NumberFormat('es-CL',{style:'currency',currency:business.currency||'CLP',maximumFractionDigits:0}).format(revenue)
    const text=question.toLocaleLowerCase('es')
    if(/agenda|cita|reserva|hoy|confirm/.test(text))return NextResponse.json({reply:`Hoy hay ${rows.length} reservas: ${confirmed} confirmadas y ${pending} pendientes.`,href:'/admin/agenda',label:'Abrir agenda'})
    if(/seguimiento|ausen|presupuesto|espera|contactar/.test(text))return NextResponse.json({reply:`Hay ${followups.count??0} tareas para atender y ${waitlist.count??0} clientes esperando un cupo.`,href:'/admin/seguimiento',label:'Abrir seguimiento'})
    if(/dinero|ingreso|venta|pago|caja|finanza/.test(text))return NextResponse.json({reply:`Los pagos registrados hoy suman ${money}.`,href:'/admin/finanzas',label:'Abrir finanzas'})
    if(/cliente/.test(text))return NextResponse.json({reply:`El negocio tiene ${clients.count??0} clientes registrados.`,href:'/admin/clientes',label:'Abrir clientes'})
    if(/equipo|profesional|estilista|manicur/.test(text))return NextResponse.json({reply:`Hay ${professionals.count??0} profesionales activos.`,href:'/admin/equipo',label:'Abrir equipo'})
    if(/servicio|especialidad|precio/.test(text))return NextResponse.json({reply:`Hay ${services.count??0} servicios activos en el catálogo.`,href:'/admin/servicios',label:'Abrir servicios'})
    return NextResponse.json({reply:`Hoy: ${rows.length} reservas, ${followups.count??0} seguimientos y ${waitlist.count??0} personas esperando cupo. Puedo ayudarte con agenda, clientes, equipo, servicios, seguimiento o finanzas.`,href:'/admin',label:'Abrir resumen'})
  }catch(error){return apiError(error)}
}
