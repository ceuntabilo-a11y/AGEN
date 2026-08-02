import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireBusinessContext } from '@/lib/supabase-server'
import { dateKeyInZone, validTimeZone, zonedDayRange } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext()
    const { data: business, error: businessError } = await db.from('businesses').select('timezone,currency').eq('id',businessId).single()
    if (businessError) throw businessError
    const timezone = validTimeZone(business.timezone) ? business.timezone : 'America/Santiago'
    const todayKey = dateKeyInZone(new Date(), timezone)
    const { from, until } = zonedDayRange(todayKey, timezone)
    const [appointments, payments, clients, professionals] = await Promise.all([
      db.from('appointments').select('id,status,service_period,quoted_price,client:clients(full_name),professional:professionals(display_name,color),service:services(name)').eq('business_id',businessId).overlaps('service_period',`[${from},${until})`).order('service_period'),
      db.from('payments').select('amount,status').eq('business_id',businessId).eq('status','PAID').gte('paid_at',from).lt('paid_at',until),
      db.from('clients').select('id',{count:'exact',head:true}).eq('business_id',businessId).gte('created_at',from).lt('created_at',until),
      db.from('professionals').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('active',true),
    ])
    const error=appointments.error||payments.error||clients.error||professionals.error
    if(error)throw error
    return NextResponse.json({ appointments: appointments.data, revenue: payments.data?.reduce((sum,p)=>sum+Number(p.amount),0)??0, newClients: clients.count??0, activeProfessionals: professionals.count??0, timezone, currency: business.currency })
  } catch(error){return apiError(error)}
}
