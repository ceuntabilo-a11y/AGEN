import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export async function POST(request:Request){
  try{const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN']);const body=await request.json() as {specialtyId?:string;name?:string;description?:string;durationMinutes?:number;bufferBeforeMinutes?:number;bufferAfterMinutes?:number;price?:number;materialCost?:number;depositAmount?:number;professionalIds?:string[]};if(!body.specialtyId||!body.name||!body.durationMinutes)return NextResponse.json({error:'Especialidad, nombre y duración son obligatorios'},{status:400});const {data:service,error}=await db.from('services').insert({business_id:businessId,specialty_id:body.specialtyId,name:body.name.trim(),description:body.description?.trim()||null,duration_minutes:body.durationMinutes,buffer_before_minutes:body.bufferBeforeMinutes??0,buffer_after_minutes:body.bufferAfterMinutes??0,price:body.price??0,material_cost:body.materialCost??0,deposit_amount:body.depositAmount??0}).select().single();if(error)throw error;if(body.professionalIds?.length){const {error:linkError}=await db.from('professional_services').insert(body.professionalIds.map(professional_id=>({professional_id,service_id:service.id})));if(linkError)throw linkError}return NextResponse.json({service},{status:201})}catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {id?:string;changes?:Record<string,unknown>;professionalIds?:string[]}
    if(!body.id||(!body.changes&&!body.professionalIds))return NextResponse.json({error:'Datos incompletos'},{status:400})
    const {data:current,error:currentError}=await db.from('services').select('id').eq('business_id',businessId).eq('id',body.id).maybeSingle()
    if(currentError)throw currentError
    if(!current)return NextResponse.json({error:'Ese servicio no pertenece al negocio'},{status:404})
    const allowed=['name','description','duration_minutes','buffer_before_minutes','buffer_after_minutes','price','material_cost','deposit_amount','active','specialty_id']
    const changes=Object.fromEntries(Object.entries(body.changes??{}).filter(([key])=>allowed.includes(key)))
    if(typeof changes.name==='string'){const name=changes.name.trim();if(!name)return NextResponse.json({error:'El nombre no puede quedar vacío'},{status:400});changes.name=name.slice(0,160)}
    if(changes.duration_minutes!==undefined){const value=Number(changes.duration_minutes);if(!Number.isInteger(value)||value<5||value>1440)return NextResponse.json({error:'La duración debe estar entre 5 y 1440 minutos'},{status:400});changes.duration_minutes=value}
    for(const key of ['price','material_cost','deposit_amount','buffer_before_minutes','buffer_after_minutes']){
      if(changes[key]===undefined)continue
      const value=Number(changes[key])
      if(!Number.isFinite(value)||value<0)return NextResponse.json({error:'Los precios y tiempos no pueden ser negativos'},{status:400})
      changes[key]=value
    }
    if(Object.keys(changes).length){const {error}=await db.from('services').update(changes).eq('id',body.id).eq('business_id',businessId);if(error){if(error.code==='23505')return NextResponse.json({error:'Ya existe un servicio con ese nombre en la misma especialidad'},{status:409});throw error}}
    // Lista autorizada servicio-profesional: se reemplaza completa, nunca se infiere.
    if(body.professionalIds){
      const {error:deleteError}=await db.from('professional_services').delete().eq('service_id',body.id);if(deleteError)throw deleteError
      if(body.professionalIds.length){const {error}=await db.from('professional_services').insert(body.professionalIds.map(professional_id=>({professional_id,service_id:body.id})));if(error)throw error}
    }
    const {data,error}=await db.from('services').select('*,specialty:specialties(id,name),professional_services(professional_id,active)').eq('id',body.id).single()
    if(error)throw error
    return NextResponse.json({service:data})
  }catch(error){return apiError(error)}
}

/** Desactiva el servicio: deja de ofrecerse en cupos y en el agente, pero conserva el historial de reservas. */
export async function DELETE(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Falta el servicio'},{status:400})
    const {data,error}=await db.from('services').update({active:false}).eq('id',id).eq('business_id',businessId).select('id').maybeSingle()
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese servicio no pertenece al negocio'},{status:404})
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
