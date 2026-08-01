import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireProfessionalContext } from '@/lib/professional-context'
export const dynamic='force-dynamic'

export async function GET(request:Request){
  try{const {db,businessId,professional}=await requireProfessionalContext();const url=new URL(request.url);const from=url.searchParams.get('from')??new Date().toISOString();const until=url.searchParams.get('until')??new Date(Date.now()+7*86400000).toISOString();const {data,error}=await db.from('appointments').select('id,status,service_period,quoted_price,deposit_paid,notes,client:clients(id,full_name,phone,notes),service:services(id,name,duration_minutes)').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('service_period',`[${from},${until})`).order('service_period');if(error)throw error;return NextResponse.json({professional,appointments:data})}catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{const {db,businessId,professional}=await requireProfessionalContext();const body=await request.json() as {appointmentId?:string;status?:string};const allowed=['CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','NO_SHOW'];if(!body.appointmentId||!body.status||!allowed.includes(body.status))return NextResponse.json({error:'Cambio inválido'},{status:400});const {data,error}=await db.from('appointments').update({status:body.status,updated_at:new Date().toISOString()}).eq('id',body.appointmentId).eq('business_id',businessId).eq('professional_id',professional.id).select().single();if(error)throw error;return NextResponse.json({appointment:data})}catch(error){return apiError(error)}
}
