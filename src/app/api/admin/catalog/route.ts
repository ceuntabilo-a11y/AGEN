import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireBusinessContext } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext()
    const [business, specialties, services, professionals, branches] = await Promise.all([
      db.from('businesses').select('id,name,timezone,currency,settings').eq('id',businessId).single(),
      db.from('specialties').select('*').eq('business_id',businessId).order('name'),
      db.from('services').select('*,specialty:specialties(id,name),professional_services(professional_id,active)').eq('business_id',businessId).order('name'),
      db.from('professionals').select('*,professional_services(service_id,active),professional_specialties(specialty_id)').eq('business_id',businessId).order('display_name'),
      db.from('branches').select('*').eq('business_id',businessId).order('name'),
    ])
    const error = business.error || specialties.error || services.error || professionals.error || branches.error
    if (error) throw error
    return NextResponse.json({ businessId, business: business.data, specialties: specialties.data, services: services.data, professionals: professionals.data, branches: branches.data })
  } catch (error) { return apiError(error) }
}
