import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

const slugify=(value:string)=>(value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80))||'especialidad'

async function uniqueSlug(db:any,businessId:string,name:string,excludeId?:string){
  const base=slugify(name)
  for(let index=0;index<50;index+=1){
    const slug=index===0?base:`${base}-${index+1}`
    let query=db.from('specialties').select('id').eq('business_id',businessId).eq('slug',slug)
    if(excludeId)query=query.neq('id',excludeId)
    const {data}=await query.maybeSingle()
    if(!data)return slug
  }
  return `${base}-${Date.now()}`
}

export async function POST(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {name?:string;color?:string}
    const name=body.name?.trim()??''
    if(!name||name.length>80)return NextResponse.json({error:'Nombre obligatorio (máximo 80 caracteres)'},{status:400})
    const color=/^#[0-9a-fA-F]{6}$/.test(body.color??'')?body.color as string:'#64748b'
    const slug=await uniqueSlug(db,businessId,name)
    const {data,error}=await db.from('specialties').insert({business_id:businessId,name,slug,color}).select().single()
    if(error)throw error
    return NextResponse.json({specialty:data},{status:201})
  }catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {id?:string;name?:string;color?:string}
    if(!body.id)return NextResponse.json({error:'Especialidad inválida'},{status:400})
    const name=body.name?.trim()??''
    if(body.name!==undefined&&(!name||name.length>80))return NextResponse.json({error:'Nombre obligatorio (máximo 80 caracteres)'},{status:400})
    const update:{name?:string;color?:string;slug?:string}={}
    if(body.name!==undefined){update.name=name;update.slug=await uniqueSlug(db,businessId,name,body.id)}
    if(body.color!==undefined&&/^#[0-9a-fA-F]{6}$/.test(body.color))update.color=body.color
    if(Object.keys(update).length===0)return NextResponse.json({error:'Nada que actualizar'},{status:400})
    const {data,error}=await db.from('specialties').update(update).eq('id',body.id).eq('business_id',businessId).select().single()
    if(error)throw error
    return NextResponse.json({specialty:data})
  }catch(error){return apiError(error)}
}

export async function DELETE(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Especialidad inválida'},{status:400})
    const [services,links]=await Promise.all([
      db.from('services').select('id').eq('business_id',businessId).eq('specialty_id',id).limit(1),
      db.from('professional_specialties').select('specialty_id').eq('specialty_id',id).limit(1),
    ])
    if((services.data??[]).length||(links.data??[]).length)return NextResponse.json({error:'No se puede eliminar: tiene servicios o profesionales asociados'},{status:409})
    const {error}=await db.from('specialties').delete().eq('id',id).eq('business_id',businessId)
    if(error)throw error
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
