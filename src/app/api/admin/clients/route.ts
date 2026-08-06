import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { normalizePhone } from '@/lib/phone'
export const dynamic='force-dynamic'

export async function GET(request:Request){try{const {db,businessId}=await requireBusinessContext();const query=new URL(request.url).searchParams.get('q')?.trim();let builder=db.from('clients').select('id,full_name,phone,email,birthday,notes,marketing_opt_in,created_at,client_memory(preferences,conversation_summary,last_interaction_at)').eq('business_id',businessId).order('full_name').limit(100);if(query)builder=builder.or(`full_name.ilike.%${query.replace(/[%_,]/g,'')}%,phone.ilike.%${query.replace(/[%_,]/g,'')}%`);const {data,error}=await builder;if(error)throw error;return NextResponse.json({clients:data})}catch(error){return apiError(error)}}
export async function POST(request:Request){try{const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST']);const body=await request.json() as {fullName?:string;phone?:string;email?:string;birthday?:string;notes?:string;marketingOptIn?:boolean};if(!body.fullName)return NextResponse.json({error:'El nombre es obligatorio'},{status:400});const phone=normalizePhone(body.phone)||null;const {data,error}=await db.from('clients').insert({business_id:businessId,full_name:body.fullName.trim(),phone,email:body.email?.trim().toLowerCase()||null,birthday:body.birthday||null,notes:body.notes?.trim()||null,marketing_opt_in:body.marketingOptIn??false}).select().single();if(error?.code==='23505')return NextResponse.json({error:'Ya existe un cliente con ese teléfono'},{status:409});if(error)throw error;if(body.marketingOptIn){const channels=[];if(data.phone)channels.push('WHATSAPP');if(data.email)channels.push('EMAIL');if(channels.length)await db.from('communication_consents').insert(channels.map(channel=>({client_id:data.id,channel,purpose:'MARKETING',granted:true,source:'ADMIN'})))}return NextResponse.json({client:data},{status:201})}catch(error){return apiError(error)}}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    const body=await request.json() as {id?:string;changes?:Record<string,unknown>}
    if(!body.id||!body.changes)return NextResponse.json({error:'Datos incompletos'},{status:400})
    const allowed=['full_name','email','birthday','notes','marketing_opt_in']
    const changes=Object.fromEntries(Object.entries(body.changes).filter(([key])=>allowed.includes(key)))
    if(typeof changes.full_name==='string'){const name=changes.full_name.trim();if(!name)return NextResponse.json({error:'El nombre no puede quedar vacío'},{status:400});changes.full_name=name.slice(0,160)}
    if(typeof changes.email==='string')changes.email=changes.email.trim().toLowerCase()||null
    if(typeof changes.notes==='string')changes.notes=changes.notes.trim().slice(0,1000)||null
    if(changes.birthday==='')changes.birthday=null
    if('phone' in body.changes){const raw=String(body.changes.phone??'').trim();if(!raw)changes.phone=null;else{const phone=normalizePhone(raw);if(!phone)return NextResponse.json({error:'Teléfono inválido'},{status:400});changes.phone=phone}}
    const {data,error}=await db.from('clients').update(changes).eq('id',body.id).eq('business_id',businessId).select().maybeSingle()
    if(error?.code==='23505')return NextResponse.json({error:'Ya existe un cliente con ese teléfono'},{status:409})
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese cliente no pertenece al negocio'},{status:404})
    // El consentimiento de marketing se mantiene alineado con la casilla del perfil.
    if('marketing_opt_in' in changes){
      const granted=Boolean(changes.marketing_opt_in)
      const channels=[...(data.phone?['WHATSAPP']:[]),...(data.email?['EMAIL']:[])]
      if(channels.length){const {error:consentError}=await db.from('communication_consents').upsert(channels.map(channel=>({client_id:data.id,channel,purpose:'MARKETING',granted,source:'ADMIN'})),{onConflict:'client_id,channel,purpose'});if(consentError)throw consentError}
    }
    return NextResponse.json({client:data})
  }catch(error){return apiError(error)}
}

export async function DELETE(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Falta el cliente'},{status:400})
    const {count,error:countError}=await db.from('appointments').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('client_id',id)
    if(countError)throw countError
    if((count??0)>0)return NextResponse.json({error:'Este cliente tiene reservas registradas: no se puede eliminar sin perder su historial.'},{status:409})
    const {data,error}=await db.from('clients').delete().eq('id',id).eq('business_id',businessId).select('id').maybeSingle()
    if(error?.code==='23503')return NextResponse.json({error:'Este cliente tiene pagos o presupuestos asociados y no se puede eliminar.'},{status:409})
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese cliente no pertenece al negocio'},{status:404})
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
