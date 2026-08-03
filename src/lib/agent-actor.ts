import {createAdminClient} from '@/lib/supabase-admin'
import {normalizePhone} from '@/lib/phone'

type AdminDb=ReturnType<typeof createAdminClient>

export type AgentTeamActor={
  actorType:'TEAM'
  kind:'PROFESSIONAL'|'STAFF'
  id:string
  name:string
  role:string
  professionalId:string|null
}

function matchesPhone(stored:unknown,incoming:string){
  const normalized=normalizePhone(stored)
  if(!normalized||!incoming)return false
  if(normalized===incoming)return true
  const tail=incoming.slice(-8)
  return tail.length===8&&normalized.endsWith(tail)
}

export async function findAgentTeamActor(db:AdminDb,businessId:string,phoneValue:unknown):Promise<AgentTeamActor|null>{
  const phone=normalizePhone(phoneValue)
  if(phone.length<7)return null
  const [professionals,members]=await Promise.all([
    db.from('professionals').select('id,display_name,phone,member_id').eq('business_id',businessId).eq('active',true),
    db.from('business_members').select('id,role,agent_phone,agent_display_name').eq('business_id',businessId).eq('active',true),
  ])
  if(professionals.error||members.error)throw professionals.error||members.error
  const professional=(professionals.data??[]).find(item=>matchesPhone(item.phone,phone))
  if(professional)return{actorType:'TEAM',kind:'PROFESSIONAL',id:professional.member_id??professional.id,name:professional.display_name,role:'PROFESSIONAL',professionalId:professional.id}
  const member=(members.data??[]).find(item=>matchesPhone(item.agent_phone,phone))
  if(!member)return null
  return{actorType:'TEAM',kind:'STAFF',id:member.id,name:member.agent_display_name||member.role,role:member.role,professionalId:null}
}

export async function rejectTeamActor(db:AdminDb,businessId:string,phoneValue:unknown){
  return Boolean(await findAgentTeamActor(db,businessId,phoneValue))
}
