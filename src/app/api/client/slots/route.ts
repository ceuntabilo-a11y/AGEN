import { NextResponse } from 'next/server'
import { requireClientContext } from '@/lib/client-context'
import { apiError } from '@/lib/http-errors'

export async function POST(request:Request){
  try{
    const {db,businessId}=await requireClientContext()
    const body=await request.json() as {serviceId?:string;from?:string;until?:string}
    if(!body.serviceId||!body.from||!body.until)return NextResponse.json({error:'Faltan datos obligatorios'},{status:400})
    const from=new Date(body.from),until=new Date(body.until)
    if(Number.isNaN(from.getTime())||Number.isNaN(until.getTime())||until<=from||until.getTime()-from.getTime()>14*86400000)return NextResponse.json({error:'Ventana inválida'},{status:400})
    const {data:business}=await db.from('businesses').select('settings').eq('id',businessId).single()
    const interval=Math.min(120,Math.max(5,Number(business?.settings?.booking_interval_minutes??15)))
    const {data,error}=await db.rpc('find_service_slots',{p_business_id:businessId,p_service_id:body.serviceId,p_from:from.toISOString(),p_until:until.toISOString(),p_interval_minutes:interval,p_limit:50})
    if(error)throw error
    return NextResponse.json({slots:data})
  }catch(error){return apiError(error)}
}
