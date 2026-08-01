import { NextResponse } from 'next/server'
import { requireClientContext } from '@/lib/client-context'
import { apiError } from '@/lib/http-errors'

export async function POST(request:Request){
  try{
    const {db,businessId,clientId}=await requireClientContext()
    const body=await request.json() as {branchId?:string|null;serviceId?:string;professionalId?:string;desiredStart?:string;notes?:string}
    if(!body.serviceId||!body.professionalId||!body.desiredStart)return NextResponse.json({error:'Faltan datos obligatorios'},{status:400})
    const {data,error}=await db.rpc('create_safe_appointment',{p_business_id:businessId,p_branch_id:body.branchId??null,p_client_id:clientId,p_professional_id:body.professionalId,p_service_id:body.serviceId,p_desired_start:body.desiredStart,p_source:'CLIENT',p_notes:body.notes?.slice(0,1000)??null})
    if(error?.code==='23P01')return NextResponse.json({error:error.message,conflict:true},{status:409})
    if(error)throw error
    return NextResponse.json({appointment:data},{status:201})
  }catch(error){return apiError(error)}
}
