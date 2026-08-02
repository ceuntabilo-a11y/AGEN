import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireProfessionalContext } from '@/lib/professional-context'
import { dateKeyInZone, validTimeZone, zonedDayRange } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId, professional } = await requireProfessionalContext()
    const { data: business, error: businessError } = await db.from('businesses').select('timezone,currency').eq('id',businessId).single()
    if (businessError) throw businessError
    const timezone = validTimeZone(business.timezone) ? business.timezone : 'America/Santiago'
    const { from, until } = zonedDayRange(dateKeyInZone(new Date(),timezone),timezone)
    const { data, error } = await db.from('appointments').select('id,status,service_period,quoted_price,client:clients(full_name),service:services(name)').eq('business_id',businessId).eq('professional_id',professional.id).overlaps('service_period',`[${from},${until})`).order('service_period')
    if (error) throw error
    const completed = data?.filter((appointment) => appointment.status === 'COMPLETED') ?? []
    const commission = completed.reduce((sum, appointment) => sum + Number(appointment.quoted_price) * Number(professional.commission_percent) / 100, 0)
    return NextResponse.json({ professional, appointments:data, commission, timezone, currency:business.currency })
  } catch (error) {
    return apiError(error)
  }
}
