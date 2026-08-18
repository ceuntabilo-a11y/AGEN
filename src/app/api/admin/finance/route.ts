import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { dateKeyInZone, startOfMonthDateKey, validTimeZone, zonedDateTimeToUtc } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    // El negocio entero: el presupuesto se dibuja con su logo, su color y sus datos de contacto.
    const { data:business, error:businessError } = await db.from('businesses')
      .select('id,name,logo_url,address,phone,email,timezone,currency,settings').eq('id',businessId).single()
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
      db.from('quotes').select('id,status,subtotal,discount,tax,total,valid_until,notes,created_at,client:clients(id,full_name,phone,email),professional:professionals(id,display_name),quote_items(id,description,quantity,unit_price,line_total)').eq('business_id',businessId).order('created_at',{ascending:false}).limit(100),
    ])
    /*
     * Búsqueda por nombre del cliente, teléfono o descripción.
     *
     * Las listas de finanzas no tenían buscador: con veinte registros a la vista, encontrar el
     * cobro de una persona concreta era imposible. Se filtra en el servidor sobre un lote más
     * grande —no en el navegador— para que buscar encuentre también lo que no cabía en la
     * primera página.
     */
    const busqueda = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const tope = busqueda ? 400 : 20
    const topePendientes = busqueda ? 400 : 50

    const [recentPayments,recentExpenses,pending] = await Promise.all([
      db.from('payments').select('id,amount,status,method,notes,paid_at,created_at,appointment_id,client:clients(id,full_name,phone,email)').eq('business_id',businessId).eq('status','PAID').order('paid_at',{ascending:false}).limit(tope),
      db.from('expenses').select('id,category,description,amount,incurred_on,notes,professional:professionals(id,display_name)').eq('business_id',businessId).order('incurred_on',{ascending:false}).limit(tope),
      db.from('payments').select('id,amount,status,method,notes,created_at,appointment_id,client:clients(id,full_name,phone,email)').eq('business_id',businessId).eq('status','PENDING').order('created_at',{ascending:false}).limit(topePendientes),
    ])
    const error = payments.error || expenses.error || appointments.error || quotes.error || recentPayments.error || recentExpenses.error || pending.error
    if (error) throw error
    const sales = payments.data?.reduce((sum,payment) => sum + Number(payment.amount),0) ?? 0
    const directCosts = appointments.data?.reduce((sum,appointment) => sum + Number(appointment.material_cost),0) ?? 0
    const commissions = appointments.data?.reduce((sum,appointment) => {
      const professional = Array.isArray(appointment.professional) ? appointment.professional[0] : appointment.professional
      return sum + Number(appointment.quoted_price) * Number(professional?.commission_percent ?? 0) / 100
    },0) ?? 0
    const operatingExpenses = expenses.data?.reduce((sum,expense) => sum + Number(expense.amount),0) ?? 0
    // El importe por cobrar es SIEMPRE el total pendiente, se esté buscando o no: es una cifra
    // del negocio, no de la lista que se está mirando.
    const receivable = (pending.data ?? []).reduce((sum,payment) => sum + Number(payment.amount),0)

    const nombreDe = (fila: Record<string, any>) => {
      const cliente = Array.isArray(fila.client) ? fila.client[0] : fila.client
      return `${cliente?.full_name ?? ''} ${cliente?.phone ?? ''} ${cliente?.email ?? ''}`.toLowerCase()
    }
    const filtrar = <T extends Record<string, any>>(filas: T[] | null, extra: (fila: T) => string): T[] => {
      if (!busqueda) return (filas ?? []).slice(0, 20)
      return (filas ?? []).filter((fila) => `${nombreDe(fila)} ${extra(fila)}`.toLowerCase().includes(busqueda)).slice(0, 50)
    }

    return NextResponse.json({
      sales,directCosts,commissions,operatingExpenses,
      net:sales-directCosts-commissions-operatingExpenses,receivable,
      quotes: filtrar(quotes.data as any[], (quote) => (quote.quote_items ?? []).map((item: any) => item.description).join(' ')),
      appointments:appointments.data,
      recentPayments: filtrar(recentPayments.data as any[], (payment) => `${payment.method ?? ''} ${payment.notes ?? ''}`),
      recentExpenses: filtrar(recentExpenses.data as any[], (expense) => `${expense.description ?? ''} ${expense.category ?? ''} ${expense.notes ?? ''}`),
      pendingPayments: filtrar(pending.data as any[], (payment) => `${payment.method ?? ''} ${payment.notes ?? ''}`),
      currency:business.currency,timezone,
      business,
      query: busqueda || null,
    })
  } catch (error) {
    return apiError(error)
  }
}
