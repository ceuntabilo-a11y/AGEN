import { NextResponse } from 'next/server'
import { requireProfessionalContext } from '@/lib/professional-context'
import { apiError } from '@/lib/http-errors'
export const dynamic='force-dynamic'
export async function GET(){try{const {db,businessId,professional}=await requireProfessionalContext();const {data,error}=await db.from('appointments').select('client:clients(id,full_name,phone,email,notes),service:services(name),service_period,status').eq('business_id',businessId).eq('professional_id',professional.id).order('service_period',{ascending:false}).limit(500);if(error)throw error;const seen=new Set<string>();const clients=(data??[]).flatMap(a=>{const client=Array.isArray(a.client)?a.client[0]:a.client;if(!client||seen.has(client.id))return[];seen.add(client.id);return[{...client,lastService:(Array.isArray(a.service)?a.service[0]:a.service)?.name,lastVisit:a.service_period}]});return NextResponse.json({clients})}catch(error){return apiError(error)}}
