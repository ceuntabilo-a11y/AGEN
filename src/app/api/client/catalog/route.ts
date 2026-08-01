import { NextResponse } from 'next/server'
import { requireClientContext } from '@/lib/client-context'
import { apiError } from '@/lib/http-errors'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId, client } = await requireClientContext()
    const [business, services, professionals] = await Promise.all([
      db.from('businesses').select('id,name,timezone,currency,address').eq('id',businessId).single(),
      db.from('services').select('id,name,description,duration_minutes,price,deposit_amount,specialty:specialties(id,name)').eq('business_id',businessId).eq('active',true).order('name'),
      db.from('professionals').select('id,display_name,color,bio,professional_services(service_id,active)').eq('business_id',businessId).eq('active',true).order('display_name'),
    ])
    const error=business.error||services.error||professionals.error
    if(error)throw error
    return NextResponse.json({ business: business.data, client, services: services.data, professionals: professionals.data })
  } catch(error){return apiError(error)}
}
