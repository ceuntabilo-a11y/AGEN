import { NextResponse } from 'next/server'
import { requireProfessionalContext } from '@/lib/professional-context'
import { apiError } from '@/lib/http-errors'
export const dynamic='force-dynamic'
export async function GET(){try{const {db,businessId,professional}=await requireProfessionalContext();const {data,error}=await db.from('portfolio_items').select('id,title,description,before_url,after_url,client_consent,published,created_at,service:services(name)').eq('business_id',businessId).eq('professional_id',professional.id).order('created_at',{ascending:false});if(error)throw error;return NextResponse.json({items:data,professional})}catch(error){return apiError(error)}}
