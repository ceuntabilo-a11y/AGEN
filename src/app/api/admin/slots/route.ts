import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
export async function POST(request:Request){try{const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL']);const body=await request.json() as {serviceId?:string;from?:string;until?:string};if(!body.serviceId||!body.from||!body.until)return NextResponse.json({error:'Faltan datos'},{status:400});const {data,error}=await db.rpc('find_service_slots',{p_business_id:businessId,p_service_id:body.serviceId,p_from:body.from,p_until:body.until,p_interval_minutes:15,p_limit:100});if(error)throw error;return NextResponse.json({slots:data})}catch(error){return apiError(error)}}
