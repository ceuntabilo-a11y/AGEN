import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireBusinessContext } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL'])
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? new Date().toISOString()
    const until = url.searchParams.get('until') ?? new Date(Date.now() + 7 * 86400000).toISOString()
    const { data, error } = await db.from('appointments').select('id,status,source,period,service_period,quoted_price,deposit_paid,notes,client:clients(id,full_name,phone),professional:professionals(id,display_name,color),service:services(id,name,duration_minutes,specialty:specialties(id,name))').eq('business_id', businessId).overlaps('service_period', `[${from},${until})`).order('service_period')
    if (error) throw error
    return NextResponse.json({ appointments: data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL'])
    const body = await request.json() as { branchId?: string|null; clientId?: string; professionalId?: string; serviceId?: string; desiredStart?: string; notes?: string }
    if (!body.clientId || !body.professionalId || !body.serviceId || !body.desiredStart) return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
    const desiredStart = new Date(body.desiredStart)
    if (Number.isNaN(desiredStart.getTime()) || desiredStart.getTime() <= Date.now()) return NextResponse.json({ error: 'La fecha debe ser futura' }, { status: 400 })
    const { data, error } = await db.rpc('create_safe_appointment', { p_business_id: businessId, p_branch_id: body.branchId ?? null, p_client_id: body.clientId, p_professional_id: body.professionalId, p_service_id: body.serviceId, p_desired_start: desiredStart.toISOString(), p_source: 'ADMIN', p_notes: body.notes?.slice(0,1000) ?? null })
    if (error?.code === '23P01') return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
    if (error) throw error
    return NextResponse.json({ appointment: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    const body = await request.json() as {
      appointmentId?: string
      action?: 'status' | 'cancel' | 'reschedule'
      status?: string
      newStart?: string
      reason?: string
    }
    if (!body.appointmentId || !body.action) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

    const { data: current, error: currentError } = await db.from('appointments').select('id,status,notes').eq('id',body.appointmentId).eq('business_id',businessId).maybeSingle()
    if (currentError) throw currentError
    if (!current) return NextResponse.json({ error: 'Reserva inexistente' }, { status: 404 })

    if (body.action === 'cancel') {
      if (current.status === 'CANCELLED') return NextResponse.json({ appointment: current })
      const { data, error } = await db.rpc('cancel_safe_appointment', { p_appointment_id: body.appointmentId })
      if (error) throw error
      if (body.reason?.trim()) await db.from('appointments').update({ notes: [current.notes, `Cancelación: ${body.reason.trim()}`].filter(Boolean).join('\n').slice(0,1000) }).eq('id',body.appointmentId).eq('business_id',businessId)
      return NextResponse.json({ appointment: data })
    }

    if (body.action === 'reschedule') {
      const newStart = body.newStart ? new Date(body.newStart) : null
      if (!newStart || Number.isNaN(newStart.getTime())) return NextResponse.json({ error: 'Nueva fecha inválida' }, { status: 400 })
      const { data, error } = await db.rpc('reschedule_safe_appointment', { p_appointment_id: body.appointmentId, p_new_start: newStart.toISOString() })
      if (error?.code === '23P01') return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
      if (error) throw error
      return NextResponse.json({ appointment: data })
    }

    const transitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED','CHECKED_IN','CANCELLED','NO_SHOW'],
      CONFIRMED: ['CHECKED_IN','CANCELLED','NO_SHOW'],
      CHECKED_IN: ['IN_PROGRESS','CANCELLED'],
      IN_PROGRESS: ['COMPLETED'],
    }
    if (!body.status || !(transitions[current.status] ?? []).includes(body.status)) return NextResponse.json({ error: 'Cambio de estado no permitido' }, { status: 400 })
    const { data, error } = await db.from('appointments').update({ status: body.status, updated_at: new Date().toISOString() }).eq('id',body.appointmentId).eq('business_id',businessId).select().single()
    if (error) throw error
    return NextResponse.json({ appointment: data })
  } catch (error) { return apiError(error) }
}
