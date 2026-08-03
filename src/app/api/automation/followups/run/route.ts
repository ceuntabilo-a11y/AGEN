import {NextResponse} from 'next/server'
import {isAuthorizedAgent} from '@/lib/agent-auth'
import {createAdminClient} from '@/lib/supabase-admin'
import {dateKeyInZone,zonedDayRange} from '@/lib/timezone'

export const dynamic='force-dynamic'

export async function POST(request:Request){
  if(!isAuthorizedAgent(request))return NextResponse.json({error:'No autorizado'},{status:401})
  const db=createAdminClient(),now=new Date()
  const {data:businesses,error}=await db.from('businesses').select('id,timezone').eq('active',true)
  if(error)return NextResponse.json({error:'No se pudieron cargar los negocios'},{status:500})
  let tasksCreated=0,summariesCreated=0
  for(const business of businesses??[]){
    const generated=await db.rpc('generate_follow_up_tasks',{p_business_id:business.id})
    if(!generated.error)tasksCreated+=Number(generated.data??0)
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
  return NextResponse.json({ok:true,businesses:(businesses??[]).length,tasksCreated,summariesCreated})
}
