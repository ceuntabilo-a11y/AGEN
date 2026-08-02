import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { dateKeyInZone, startOfMonthDateKey, validTimeZone, zonedDateTimeToUtc } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    const { data:business, error:businessError } = await db.from('businesses').select('timezone,currency').eq('id',businessId).single()
    if (businessError) throw businessError
    const timezone = validTimeZone(business.timezone) ? business.timezone : 'America/Santiago'
    const currentMonth = startOfMonthDateKey(dateKeyInZone(new Date(),timezone))
    const [year,month] = currentMonth.split('-').map(Number)
    const nextMonth = new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? zonedDateTimeToUtc(currentMonth,'00:00:00',timezone).toISOString()
    const until = url.searchParams.get('until') ?? zonedDateTimeToUtc(nextMonth,'00:00:00',timezone).toISOString()
    const expenseFrom = dateKeyInZone(from,timezone)
    const expenseUntil = dateKeyInZone(until,timezone)

    const [payments,expenses,appointments,quotes] = await Promise.all([
      db.from('payments').select('amount,status,method,paid_at').eq('business_id',businessId).eq('status','PAID').gte('paid_at',from).lt('paid_at',until),
      db.from('expenses').select('amount,category,description,incurred_on').eq('business_id',businessId).gte('incurred_on',expenseFrom).lt('incurred_on',expenseUntil),
      db.from('appointments').select('quoted_price,material_cost,status,professional:professionals(id,display_name,color,commission_percent)').eq('business_id',businessId).eq('status','COMPLETED').overlaps('service_period',`[${from},${until})`),
      db.from('quotes').select('id,status,total,created_at,client:clients(full_name),quote_items(description)').eq('business_id',businessId).order('created_at',{ascending:false}).limit(10),
    ])
    const error = payments.error || expenses.error || appointments.error || quotes.error
    if (error) throw error
    const sales = payments.data?.reduce((sum,payment) => sum + Number(payment.amount),0) ?? 0
    const directCosts = appointments.data?.reduce((sum,appointment) => sum + Number(appointment.material_cost),0) ?? 0
    const commissions = appointments.data?.reduce((sum,appointment) => {
      const professional = Array.isArray(appointment.professional) ? appointment.professional[0] : appointment.professional
      return sum + Number(appointment.quoted_price) * Number(professional?.commission_percent ?? 0) / 100
    },0) ?? 0
    const operatingExpenses = expenses.data?.reduce((sum,expense) => sum + Number(expense.amount),0) ?? 0
    return NextResponse.json({ sales,directCosts,commissions,operatingExpenses,net:sales-directCosts-commissions-operatingExpenses,quotes:quotes.data,appointments:appointments.data,currency:business.currency,timezone })
  } catch (error) {
    return apiError(error)
  }
}
