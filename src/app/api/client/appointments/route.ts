import { NextResponse } from 'next/server'
import { requireClientContext } from '@/lib/client-context'
import { apiError } from '@/lib/http-errors'
export const dynamic = 'force-dynamic'

export async function GET(){
  try{const {db,businessId,clientId}=await requireClientContext();const {data,error}=await db.from('appointments').select('id,status,service_period,quoted_price,deposit_paid,professional:professionals(id,display_name,color),service:services(id,name),branch:branches(id,name,address)').eq('business_id',businessId).eq('client_id',clientId).order('service_period',{ascending:false});if(error)throw error;return NextResponse.json({appointments:data})}catch(error){return apiError(error)}
}

export async function PATCH(request:Request){
  try{const {db,clientId}=await requireClientContext();const body=await request.json() as {appointmentId?:string;action?:'cancel'|'reschedule';newStart?:string};if(!body.appointmentId||!body.action)return NextResponse.json({error:'Datos incompletos'},{status:400});const {data:owned}=await db.from('appointments').select('id').eq('id',body.appointmentId).eq('client_id',clientId).maybeSingle();if(!owned)return NextResponse.json({error:'Reserva inexistente'},{status:404});const result=body.action==='cancel'?await db.rpc('cancel_safe_appointment',{p_appointment_id:body.appointmentId}):await db.rpc('reschedule_safe_appointment',{p_appointment_id:body.appointmentId,p_new_start:body.newStart});if(result.error?.code==='23P01')return NextResponse.json({error:result.error.message,conflict:true},{status:409});if(result.error)return NextResponse.json({error:result.error.message},{status:400});return NextResponse.json({appointment:result.data})}catch(error){return apiError(error)}
}
