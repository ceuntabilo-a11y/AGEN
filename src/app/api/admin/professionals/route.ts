import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { apiError } from '@/lib/http-errors'
import { normalizePhone } from '@/lib/phone'

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
      if(memberError.code==='23505'){await cleanup();return NextResponse.json({error:'Ese usuario ya pertenece al negocio'},{status:409})}
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
    return NextResponse.json({professional,inviteLink},{status:201})
  }catch(error){
    if(createdUserId){try{await createAdminClient().auth.admin.deleteUser(createdUserId)}catch{}}
    return apiError(error)
  }
}
