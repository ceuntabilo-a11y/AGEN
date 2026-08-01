import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireProfessionalContext } from '@/lib/professional-context'
export const dynamic='force-dynamic'

export async function GET(){
  try{const {db,businessId,professional}=await requireProfessionalContext();const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);const {data,error}=await db.from('appointments').select('id,status,service_period,quoted_price,client:clients(full_name),service:services(name)').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('service_period',`[${start.toISOString()},${end.toISOString()})`).order('service_period');if(error)throw error;const completed=data?.filter(a=>a.status==='COMPLETED')??[];const commission=completed.reduce((sum,a)=>sum+Number(a.quoted_price)*Number(professional.commission_percent)/100,0);return NextResponse.json({professional,appointments:data,commission})}catch(error){return apiError(error)}
}
