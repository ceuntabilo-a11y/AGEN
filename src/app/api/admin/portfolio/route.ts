import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { signPortfolioItems } from '@/lib/storage'
export const dynamic='force-dynamic'
export async function GET(){try{const {db,businessId}=await requireBusinessContext();const {data,error}=await db.from('portfolio_items').select('id,title,description,before_url,after_url,client_consent,published,created_at,professional:professionals(id,display_name),service:services(id,name)').eq('business_id',businessId).order('created_at',{ascending:false});if(error)throw error;return NextResponse.json({items:await signPortfolioItems(db,data)})}catch(error){return apiError(error)}}
export async function POST(request:Request){try{const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','PROFESSIONAL']);const body=await request.json() as {professionalId?:string;serviceId?:string|null;clientId?:string|null;title?:string;description?:string;beforeUrl?:string|null;afterUrl?:string;clientConsent?:boolean;published?:boolean};if(!body.professionalId||!body.title||!body.afterUrl)return NextResponse.json({error:'Profesional, título e imagen son obligatorios'},{status:400});if(body.published&&!body.clientConsent)return NextResponse.json({error:'Se requiere autorización del cliente para publicar'},{status:400});const {data,error}=await db.from('portfolio_items').insert({business_id:businessId,professional_id:body.professionalId,service_id:body.serviceId??null,client_id:body.clientId??null,title:body.title.trim(),description:body.description?.trim()||null,before_url:body.beforeUrl??null,after_url:body.afterUrl,client_consent:body.clientConsent??false,published:body.published??false}).select().single();if(error)throw error;return NextResponse.json({item:data},{status:201})}catch(error){return apiError(error)}}

export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const body=await request.json() as {id?:string;changes?:Record<string,unknown>}
    if(!body.id||!body.changes)return NextResponse.json({error:'Datos incompletos'},{status:400})
    const allowed=['title','description','client_consent','published']
    const changes=Object.fromEntries(Object.entries(body.changes).filter(([key])=>allowed.includes(key)))
    if(typeof changes.title==='string'){const title=changes.title.trim();if(!title)return NextResponse.json({error:'El título no puede quedar vacío'},{status:400});changes.title=title.slice(0,160)}
    const {data,error}=await db.from('portfolio_items').update(changes).eq('id',body.id).eq('business_id',businessId).select().maybeSingle()
    if(error?.code==='23514')return NextResponse.json({error:'Se requiere autorización del cliente para publicar'},{status:400})
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese trabajo no pertenece al negocio'},{status:404})
    return NextResponse.json({item:data})
  }catch(error){return apiError(error)}
}

export async function DELETE(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Falta el trabajo'},{status:400})
    const {data,error}=await db.from('portfolio_items').delete().eq('id',id).eq('business_id',businessId).select('id').maybeSingle()
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese trabajo no pertenece al negocio'},{status:404})
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
