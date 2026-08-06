import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
export async function POST(request:Request){try{const {db,businessId,user}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL']);const body=await request.json() as {clientId?:string;professionalId?:string|null;validUntil?:string;discount?:number;tax?:number;notes?:string;items?:Array<{serviceId?:string;description:string;quantity:number;unitPrice:number;unitCost?:number}>};if(!body.clientId||!body.items?.length)return NextResponse.json({error:'Cliente e ítems son obligatorios'},{status:400});const {data:quote,error}=await db.from('quotes').insert({business_id:businessId,client_id:body.clientId,professional_id:body.professionalId??null,valid_until:body.validUntil??null,discount:body.discount??0,tax:body.tax??0,notes:body.notes?.slice(0,2000)??null,created_by:user.id}).select().single();if(error)throw error;const {error:itemError}=await db.from('quote_items').insert(body.items.map(i=>({quote_id:quote.id,service_id:i.serviceId??null,description:i.description,quantity:i.quantity,unit_price:i.unitPrice,unit_cost:i.unitCost??0})));if(itemError){await db.from('quotes').delete().eq('id',quote.id);throw itemError}const {data:complete}=await db.from('quotes').select('*,quote_items(*)').eq('id',quote.id).single();return NextResponse.json({quote:complete},{status:201})}catch(error){return apiError(error)}}

export const dynamic='force-dynamic'

export async function GET(){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL'])
    const {data,error}=await db.from('quotes').select('id,status,subtotal,discount,tax,total,valid_until,notes,created_at,client:clients(id,full_name),professional:professionals(id,display_name),quote_items(id,description,quantity,unit_price,line_total)').eq('business_id',businessId).order('created_at',{ascending:false}).limit(100)
    if(error)throw error
    return NextResponse.json({quotes:data})
  }catch(error){return apiError(error)}
}

/** Estados del presupuesto: DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED, CONVERTED. */
export async function PATCH(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    const body=await request.json() as {id?:string;status?:string;notes?:string;validUntil?:string|null}
    if(!body.id)return NextResponse.json({error:'Falta el presupuesto'},{status:400})
    const changes:Record<string,unknown>={}
    if(body.status!==undefined){
      if(!['DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED'].includes(body.status))return NextResponse.json({error:'Estado inválido'},{status:400})
      changes.status=body.status
    }
    if(body.notes!==undefined)changes.notes=body.notes?.slice(0,2000)||null
    if(body.validUntil!==undefined)changes.valid_until=body.validUntil||null
    if(!Object.keys(changes).length)return NextResponse.json({error:'Nada para actualizar'},{status:400})
    const {data,error}=await db.from('quotes').update(changes).eq('id',body.id).eq('business_id',businessId).select('id,status,total,valid_until').maybeSingle()
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese presupuesto no pertenece al negocio'},{status:404})
    return NextResponse.json({quote:data})
  }catch(error){return apiError(error)}
}

export async function DELETE(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN'])
    const id=new URL(request.url).searchParams.get('id')
    if(!id)return NextResponse.json({error:'Falta el presupuesto'},{status:400})
    const {data,error}=await db.from('quotes').delete().eq('id',id).eq('business_id',businessId).select('id').maybeSingle()
    if(error?.code==='23503')return NextResponse.json({error:'Este presupuesto tiene pagos asociados y no se puede eliminar.'},{status:409})
    if(error)throw error
    if(!data)return NextResponse.json({error:'Ese presupuesto no pertenece al negocio'},{status:404})
    return NextResponse.json({ok:true})
  }catch(error){return apiError(error)}
}
