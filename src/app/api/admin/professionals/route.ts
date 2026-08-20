import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { apiError } from '@/lib/http-errors'
import { normalizePhone } from '@/lib/phone'
import { DEFAULT_AVAILABILITY, replaceAvailability } from '@/lib/availability'

export async function POST(request:Request){
  let createdUserId:string|undefined
  try{
    const {businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {email?:string;displayName?:string;phone?:string;branchId?:string|null;color?:string;commissionPercent?:number;specialtyIds?:string[];serviceIds?:string[]}
    if(!body.email||!body.displayName)return NextResponse.json({error:'Nombre y correo son obligatorios'},{status:400})
    const email=body.email.trim().toLowerCase()
    const phone=body.phone?.trim()?normalizePhone(body.phone):null
    if(body.phone?.trim()&&!phone)return NextResponse.json({error:'Teléfono inválido'},{status:400})
    const admin=createAdminClient()
    const cleanup=async()=>{if(createdUserId){try{await admin.auth.admin.deleteUser(createdUserId)}catch{}}}
    let userId:string
    let inviteLink:string|null=null
    const link=await admin.auth.admin.generateLink({type:'invite',email,options:{redirectTo:`${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`}})
    if(link.error){
      if(link.error.code!=='email_exists'&&!/already/i.test(link.error.message))throw link.error
      const existing=await admin.auth.admin.listUsers({page:1,perPage:200})
      const match=(existing.data.users??[]).find(user=>user.email?.toLowerCase()===email)
      if(existing.error||!match)return NextResponse.json({error:'Ese correo ya está registrado y no se pudo vincular automáticamente. Inicia sesión con ese usuario o usa otro correo.'},{status:409})
      userId=match.id
    }else{
      userId=link.data.user.id
      inviteLink=link.data.properties.action_link
      createdUserId=userId
    }
    const {data:member,error:memberError}=await admin.from('business_members').insert({business_id:businessId,user_id:userId,role:'PROFESSIONAL'}).select().single()
    if(memberError){
      // Sin cleanup: si ya es miembro, el usuario es anterior a esta llamada y borrarlo dejaría al profesional existente sin acceso.
      if(memberError.code==='23505')return NextResponse.json({error:'Ese usuario ya pertenece al negocio'},{status:409})
      throw memberError
    }
    const {data:professional,error:professionalError}=await admin.from('professionals').insert({business_id:businessId,branch_id:body.branchId??null,member_id:member.id,display_name:body.displayName.trim(),phone,color:body.color??'#5b3df5',commission_percent:body.commissionPercent??0}).select().single()
    if(professionalError){
      await cleanup()
      if(professionalError.code==='42703')return NextResponse.json({error:'Faltan migraciones en la base de datos: ejecuta supabase/migrations/20260803000001_agen_latest_updates.sql en Supabase'},{status:500})
      throw professionalError
    }
    if(body.specialtyIds?.length){const {error:specialtyError}=await admin.from('professional_specialties').insert(body.specialtyIds.map(specialty_id=>({professional_id:professional.id,specialty_id})));if(specialtyError)throw specialtyError}
    if(body.serviceIds?.length){const {error:serviceError}=await admin.from('professional_services').insert(body.serviceIds.map(service_id=>({professional_id:professional.id,service_id})));if(serviceError)throw serviceError}
    // Sin horario no se generan cupos: todo profesional nuevo nace con lunes a viernes de 09:00 a 18:00, editable desde Equipo.
    await replaceAvailability(admin,professional.id,DEFAULT_AVAILABILITY)
    return NextResponse.json({professional,inviteLink},{status:201})
  }catch(error){
    if(createdUserId){try{await createAdminClient().auth.admin.deleteUser(createdUserId)}catch{}}
    return apiError(error)
  }
}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {id?:string;changes?:Record<string,unknown>;specialtyIds?:string[];serviceIds?:string[]}
    if(!body.id)return NextResponse.json({error:'Falta el profesional'},{status:400})
    const {data:current,error:currentError}=await db.from('professionals').select('id').eq('business_id',businessId).eq('id',body.id).maybeSingle()
    if(currentError)throw currentError
    if(!current)return NextResponse.json({error:'Ese profesional no pertenece al negocio'},{status:404})
    const allowed=['display_name','bio','color','commission_percent','branch_id','active','calendar_hide_client_names','photo_url']
    const changes=Object.fromEntries(Object.entries(body.changes??{}).filter(([key])=>allowed.includes(key)))
    if(typeof changes.display_name==='string'){const name=changes.display_name.trim();if(!name)return NextResponse.json({error:'El nombre no puede quedar vacío'},{status:400});changes.display_name=name.slice(0,120)}
    if(changes.commission_percent!==undefined){const value=Number(changes.commission_percent);if(!Number.isFinite(value)||value<0||value>100)return NextResponse.json({error:'La comisión debe estar entre 0 y 100'},{status:400});changes.commission_percent=value}
    if(body.changes&&'phone' in body.changes){const raw=String(body.changes.phone??'').trim();if(!raw)changes.phone=null;else{const phone=normalizePhone(raw);if(!phone)return NextResponse.json({error:'Teléfono inválido'},{status:400});changes.phone=phone}}
    if(Object.keys(changes).length){const {error}=await db.from('professionals').update(changes).eq('id',body.id).eq('business_id',businessId);if(error)throw error}
    if(body.specialtyIds){
      const {error:deleteError}=await db.from('professional_specialties').delete().eq('professional_id',body.id);if(deleteError)throw deleteError
      if(body.specialtyIds.length){const {error}=await db.from('professional_specialties').insert(body.specialtyIds.map(specialty_id=>({professional_id:body.id,specialty_id})));if(error)throw error}
    }
    if(body.serviceIds){
      const {error:deleteError}=await db.from('professional_services').delete().eq('professional_id',body.id);if(deleteError)throw deleteError
      if(body.serviceIds.length){const {error}=await db.from('professional_services').insert(body.serviceIds.map(service_id=>({professional_id:body.id,service_id})));if(error)throw error}
    }
    const {data,error}=await db.from('professionals').select('*,professional_services(service_id,active),professional_specialties(specialty_id)').eq('id',body.id).single()
    if(error)throw error
    return NextResponse.json({professional:data})
  }catch(error){return apiError(error)}
}

/** Desactiva al profesional: deja de aparecer en cupos y en el agente, pero conserva su historial de reservas. */
export async function DELETE(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Falta el profesional'},{status:400})
    const {data,error}=await db.from('professionals').update({active:false}).eq('id',id).eq('business_id',businessId).select('id').maybeSingle()
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese profesional no pertenece al negocio'},{status:404})
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
