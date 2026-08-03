import {NextResponse} from 'next/server'
import {apiError} from '@/lib/http-errors'
import {normalizePhone} from '@/lib/phone'
import {requireBusinessContext} from '@/lib/supabase-server'

export async function GET(){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const {data,error}=await db.from('business_members').select('id,role,agent_phone,agent_display_name,user_id').eq('business_id',businessId).eq('active',true).order('created_at')
    if(error)throw error
    return NextResponse.json({members:data??[]})
  }catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {memberId?:string;displayName?:string;phone?:string}
    if(!body.memberId)return NextResponse.json({error:'Miembro obligatorio'},{status:400})
    const phone=body.phone?.trim()?normalizePhone(body.phone):null
    if(body.phone?.trim()&&(!phone||phone.length<7))return NextResponse.json({error:'Teléfono inválido'},{status:400})
    const {data,error}=await db.from('business_members').update({agent_phone:phone,agent_display_name:body.displayName?.trim().slice(0,120)||null}).eq('id',body.memberId).eq('business_id',businessId).select('id,role,agent_phone,agent_display_name').maybeSingle()
    if(error?.code==='23505')return NextResponse.json({error:'Ese teléfono ya pertenece a otro miembro del equipo'},{status:409})
    if(error)throw error
    if(!data)return NextResponse.json({error:'Miembro inexistente'},{status:404})
    return NextResponse.json({member:data})
  }catch(error){return apiError(error)}
}
