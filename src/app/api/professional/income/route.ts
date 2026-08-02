import { NextResponse } from 'next/server'
import { requireProfessionalContext } from '@/lib/professional-context'
import { apiError } from '@/lib/http-errors'
import { dateKeyInZone, startOfMonthDateKey, validTimeZone, zonedDateTimeToUtc } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { db, businessId, professional } = await requireProfessionalContext()
    const { data: business, error: businessError } = await db.from('businesses').select('timezone,currency').eq('id',businessId).single()
    if (businessError) throw businessError
    const timezone = validTimeZone(business.timezone) ? business.timezone : 'America/Santiago'
    const currentMonth = startOfMonthDateKey(dateKeyInZone(new Date(),timezone))
    const [year, month] = currentMonth.split('-').map(Number)
    const nextMonth = new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? zonedDateTimeToUtc(currentMonth,'00:00:00',timezone).toISOString()
    const until = url.searchParams.get('until') ?? zonedDateTimeToUtc(nextMonth,'00:00:00',timezone).toISOString()
    const { data, error } = await db.from('appointments').select('id,quoted_price,service_period,service:services(name)').eq('business_id',businessId).eq('professional_id',professional.id).eq('status','COMPLETED').overlaps('service_period',`[${from},${until})`).order('service_period',{ascending:false})
    if (error) throw error
    const commission = (data ?? []).reduce((sum, appointment) => sum + Number(appointment.quoted_price) * Number(professional.commission_percent) / 100, 0)
    return NextResponse.json({ professional, appointments:data, commission, timezone, currency:business.currency })
  } catch (error) {
    return apiError(error)
  }
}
