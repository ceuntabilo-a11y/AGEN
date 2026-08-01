import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
export const dynamic='force-dynamic'
export async function GET(){try{const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN']);const {data,error}=await db.from('businesses').select('id,name,slug,timezone,currency,phone,email,address,logo_url,settings,agent_settings').eq('id',businessId).single();if(error)throw error;return NextResponse.json({business:data})}catch(error){return apiError(error)}}
export async function PATCH(request:Request){try{const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN']);const body=await request.json() as Record<string,unknown>;const allowed=['name','timezone','currency','phone','email','address','logo_url','settings','agent_settings'];const changes=Object.fromEntries(Object.entries(body).filter(([key])=>allowed.includes(key)));const {data,error}=await db.from('businesses').update({...changes,updated_at:new Date().toISOString()}).eq('id',businessId).select().single();if(error)throw error;return NextResponse.json({business:data})}catch(error){return apiError(error)}}
