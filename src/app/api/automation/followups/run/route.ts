import {NextResponse} from 'next/server'
import {isAuthorizedAgent} from '@/lib/agent-auth'
import {createAdminClient} from '@/lib/supabase-admin'
import {dateKeyInZone,zonedDayRange} from '@/lib/timezone'

export const dynamic='force-dynamic'

/**
 * La encuesta de satisfacción, que hasta ahora no se enviaba nunca.
 *
 * `REVIEW_REQUEST` tenía plantilla y estaba permitido en la cola desde el primer día, pero
 * NINGUNA función lo encolaba: la encuesta solo existía si alguien la escribía a mano en el
 * panel. Se encola desde acá —el workflow 04 ya corre cada hora— y no desde un disparador de
 * base de datos, para no necesitar una migración nueva.
 *
 * Cuándo se manda lo decide el negocio: `settings.survey_hours_after`, en horas después de la
 * cita (por defecto 3; con `0` la encuesta queda apagada).
 *
 * Idempotente sin índice: la unicidad de `notification_outbox` solo cubre los avisos
 * programados, así que antes de encolar se mira si esa cita ya tiene su encuesta.
 */
async function encolarEncuestas(db:ReturnType<typeof createAdminClient>,businessId:string):Promise<number>{
  try{
    const {data:negocio}=await db.from('businesses').select('settings').eq('id',businessId).maybeSingle()
    const ajustes=(negocio?.settings??{}) as Record<string,unknown>
    if(ajustes.survey_enabled===false)return 0
    const pedidas=Number(ajustes.survey_hours_after??0)
    const horas=Number.isFinite(pedidas)&&pedidas>0&&pedidas<=720?pedidas:0

    const hasta=new Date(Date.now()-horas*3600000).toISOString()
    // Solo citas ya atendidas, y de los últimos días: una encuesta de hace un mes no se manda.
    const desde=new Date(Date.now()-(horas+72)*3600000).toISOString()
    const {data:citas,error}=await db.from('appointments')
      .select('id,service_period').eq('business_id',businessId).eq('status','COMPLETED')
      .overlaps('service_period',`[${desde},${hasta})`).limit(50)
    if(error||!citas?.length)return 0

    const ids=citas.map(cita=>cita.id)
    const {data:yaEncoladas}=await db.from('notification_outbox')
      .select('appointment_id').eq('event_type','REVIEW_REQUEST').in('appointment_id',ids)
    const conEncuesta=new Set((yaEncoladas??[]).map(fila=>fila.appointment_id))

    let encoladas=0
    for(const cita of citas){
      if(conEncuesta.has(cita.id))continue
      const fin=String(cita.service_period??'').replace(/[[\]()"]/g,'').split(',')[1]
      if(fin&&new Date(fin).getTime()>Date.now()-horas*3600000)continue
      const {error:fallo}=await db.rpc('enqueue_appointment_event',{
        p_appointment_id:cita.id,p_event_type:'REVIEW_REQUEST',p_scheduled_at:new Date().toISOString(),
      })
      if(!fallo)encoladas+=1
    }
    return encoladas
  }catch{return 0}
}

export async function POST(request:Request){
  if(!isAuthorizedAgent(request))return NextResponse.json({error:'No autorizado'},{status:401})
  const db=createAdminClient(),now=new Date()
  const {data:businesses,error}=await db.from('businesses').select('id,timezone').eq('active',true)
  if(error)return NextResponse.json({error:'No se pudieron cargar los negocios'},{status:500})
  let tasksCreated=0,summariesCreated=0,surveysQueued=0
  for(const business of businesses??[]){
    const generated=await db.rpc('generate_follow_up_tasks',{p_business_id:business.id})
    if(!generated.error)tasksCreated+=Number(generated.data??0)
    surveysQueued+=await encolarEncuestas(db,business.id)
    const timezone=business.timezone||'America/Santiago'
    let localDay:string,localHour:number
    try{
      localDay=dateKeyInZone(now,timezone)
      localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hour12:false}).format(now))%24
    }catch{continue}
    if(localHour!==7)continue
    const {from,until}=zonedDayRange(localDay,timezone)
    const [appointments,members,professionals]=await Promise.all([
      db.from('appointments').select('id,status').eq('business_id',business.id).overlaps('service_period',`[${from},${until})`).not('status','eq','CANCELLED'),
      db.from('business_members').select('id,user_id,role').eq('business_id',business.id).eq('active',true),
      db.from('professionals').select('member_id,notification_preferences').eq('business_id',business.id).eq('active',true),
    ])
    if(appointments.error||members.error||professionals.error)continue
    const rows=appointments.data??[],confirmed=rows.filter(item=>item.status==='CONFIRMED').length,pending=rows.filter(item=>item.status==='PENDING').length
    const professionalPreferences=new Map((professionals.data??[]).map(item=>[item.member_id,Boolean((item.notification_preferences as Record<string,unknown>|null)?.DAILY_SUMMARY)]))
    const recipients=(members.data??[]).filter(member=>['OWNER','ADMIN','RECEPTIONIST'].includes(member.role)||professionalPreferences.get(member.id))
    if(!recipients.length)continue
    const notifications=recipients.map(member=>({
      business_id:business.id,recipient_user_id:member.user_id,event_key:`daily:${business.id}:${localDay}:${member.user_id}`,
      kind:'DAILY_SUMMARY',title:'Resumen de agenda',body:`Hoy hay ${rows.length} reservas: ${confirmed} confirmadas y ${pending} pendientes.`,payload:{date:localDay,total:rows.length,confirmed,pending},
    }))
    const inserted=await db.from('team_notifications').upsert(notifications,{onConflict:'recipient_user_id,event_key',ignoreDuplicates:true}).select('id')
    if(!inserted.error)summariesCreated+=(inserted.data??[]).length
  }
  return NextResponse.json({ok:true,businesses:(businesses??[]).length,tasksCreated,summariesCreated,surveysQueued})
}
