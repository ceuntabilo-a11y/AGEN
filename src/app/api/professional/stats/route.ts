import { NextResponse } from 'next/server'
import { requireProfessionalContext } from '@/lib/professional-context'
import { apiError } from '@/lib/http-errors'
import { validTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

/** Estadísticas propias del profesional de los últimos 90 días, calculadas en la hora local del negocio. */
export async function GET() {
  try {
    const { db, businessId, professional } = await requireProfessionalContext()
    const since = new Date(Date.now() - 90 * 86400000).toISOString()
    const [appointments, business] = await Promise.all([
      db.from('appointments').select('status,service_period,quoted_price,service:services(id,name)').eq('business_id', businessId).eq('professional_id', professional.id).gte('created_at', since).limit(2000),
      db.from('businesses').select('timezone,currency').eq('id', businessId).single(),
    ])
    if (appointments.error || business.error) throw appointments.error || business.error
    const timezone = validTimeZone(business.data?.timezone) ? business.data.timezone : 'America/Santiago'
    const rows = appointments.data ?? []

    const byService = new Map<string, { name: string; count: number; revenue: number }>()
    const byHour = new Map<number, number>()
    const byWeekday = new Map<number, number>()
    for (const row of rows) {
      const service = Array.isArray(row.service) ? row.service[0] : row.service
      const key = service?.id ?? 'sin-servicio'
      const current = byService.get(key) ?? { name: service?.name ?? 'Sin servicio', count: 0, revenue: 0 }
      current.count += 1
      if (row.status === 'COMPLETED') current.revenue += Number(row.quoted_price)
      byService.set(key, current)

      const start = new Date(String(row.service_period).replace(/[[\]()"]/g, '').split(',')[0])
      const local = new Date(start.toLocaleString('en-US', { timeZone: timezone }))
      byHour.set(local.getHours(), (byHour.get(local.getHours()) ?? 0) + 1)
      byWeekday.set(local.getDay(), (byWeekday.get(local.getDay()) ?? 0) + 1)
    }

    const completed = rows.filter((row) => row.status === 'COMPLETED').length
    const noShow = rows.filter((row) => row.status === 'NO_SHOW').length
    const cancelled = rows.filter((row) => row.status === 'CANCELLED').length
    return NextResponse.json({
      total: rows.length,
      completed,
      noShow,
      cancelled,
      completionRate: rows.length ? Math.round(completed / rows.length * 100) : 0,
      revenue: rows.filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum + Number(row.quoted_price), 0),
      services: Array.from(byService.values()).sort((a, b) => b.count - a.count).slice(0, 8),
      hours: Array.from(byHour, ([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour),
      weekdays: Array.from(byWeekday, ([weekday, count]) => ({ weekday, count })).sort((a, b) => a.weekday - b.weekday),
      currency: business.data?.currency ?? 'CLP',
    })
  } catch (error) { return apiError(error) }
}
