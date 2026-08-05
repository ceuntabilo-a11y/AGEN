import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireBusinessContext } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { db, businessId,role,memberId } = await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL'])
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? new Date().toISOString()
    const until = url.searchParams.get('until') ?? new Date(Date.now() + 7 * 86400000).toISOString()
    let appointmentsQuery=db.from('appointments').select('id,status,source,period,service_period,quoted_price,deposit_paid,notes,client:clients(id,full_name,phone),professional:professionals(id,display_name,color),service:services(id,name,duration_minutes,specialty:specialties(id,name))').eq('business_id', businessId).overlaps('service_period', `[${from},${until})`).order('service_period')
    let holdsQuery=db.from('appointment_holds').select('id,period,expires_at,contact_key,client:clients(id,full_name,phone),professional:professionals(id,display_name,color),service:services(id,name,buffer_before_minutes,buffer_after_minutes)').eq('business_id',businessId).gt('expires_at',new Date().toISOString()).overlaps('period',`[${from},${until})`).order('period')
    if(role==='PROFESSIONAL'){
      const {data:professional,error}=await db.from('professionals').select('id').eq('business_id',businessId).eq('member_id',memberId).eq('active',true).maybeSingle()
      if(error)throw error
      if(!professional)return NextResponse.json({error:'Perfil profesional inexistente'},{status:403})
      appointmentsQuery=appointmentsQuery.eq('professional_id',professional.id)
      holdsQuery=holdsQuery.eq('professional_id',professional.id)
    }
    const [appointments,holds]=await Promise.all([appointmentsQuery,holdsQuery])
    if (appointments.error||holds.error) throw appointments.error||holds.error
    return NextResponse.json({ appointments:appointments.data,holds:holds.data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db, businessId,role,memberId } = await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST','PROFESSIONAL'])
    const body = await request.json() as { branchId?: string|null; clientId?: string; professionalId?: string; serviceId?: string; desiredStart?: string; notes?: string }
    if (!body.clientId || !body.professionalId || !body.serviceId || !body.desiredStart) return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
    if(role==='PROFESSIONAL'){
      const {data:professional,error}=await db.from('professionals').select('id').eq('business_id',businessId).eq('member_id',memberId).eq('active',true).maybeSingle()
      if(error)throw error
      if(!professional||professional.id!==body.professionalId)return NextResponse.json({error:'Solo puedes reservar en tu propia agenda'},{status:403})
    }
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
      action?: 'status' | 'cancel' | 'reschedule' | 'move' | 'resize'
      status?: string
      newStart?: string
      professionalId?: string
      durationMinutes?: number
      reason?: string
      notify?: boolean
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

    if (body.action === 'reschedule' || body.action === 'move') {
      const newStart = body.newStart ? new Date(body.newStart) : null
      if (!newStart || Number.isNaN(newStart.getTime())) return NextResponse.json({ error: 'Nueva fecha inválida' }, { status: 400 })
      if(body.action==='move'&&!body.professionalId)return NextResponse.json({error:'Selecciona el profesional'},{status:400})
      const { data, error } = body.action==='move'
        ? await db.rpc('move_safe_appointment',{p_appointment_id:body.appointmentId,p_new_start:newStart.toISOString(),p_new_professional_id:body.professionalId})
        : await db.rpc('reschedule_safe_appointment', { p_appointment_id: body.appointmentId, p_new_start: newStart.toISOString() })
      if (error?.code === '23P01') return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
      if (error) throw error
      return NextResponse.json({ appointment: data })
    }

    if(body.action==='resize'){
      const duration=Math.round(Number(body.durationMinutes))
      if(!Number.isFinite(duration)||duration<5||duration>1440)return NextResponse.json({error:'Duración inválida'},{status:400})
      const {data,error}=await db.rpc('resize_safe_appointment',{p_appointment_id:body.appointmentId,p_duration_minutes:duration})
      if(error?.code==='23P01')return NextResponse.json({error:error.message,conflict:true},{status:409})
      if(error)throw error
      return NextResponse.json({appointment:data})
    }

    const transitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED','CHECKED_IN','CANCELLED','NO_SHOW','COMPLETED'],
      CONFIRMED: ['CHECKED_IN','CANCELLED','NO_SHOW','COMPLETED'],
      CHECKED_IN: ['IN_PROGRESS','CANCELLED'],
      IN_PROGRESS: ['COMPLETED'],
    }
    if (!body.status || !(transitions[current.status] ?? []).includes(body.status)) return NextResponse.json({ error: 'Cambio de estado no permitido' }, { status: 400 })
    const { data, error } = await db.from('appointments').update({ status: body.status, updated_at: new Date().toISOString() }).eq('id',body.appointmentId).eq('business_id',businessId).select().single()
    if (error) throw error
    if (body.status === 'NO_SHOW' && body.notify) {
      await db.rpc('enqueue_appointment_event', { p_appointment_id: body.appointmentId, p_event_type: 'FOLLOW_UP' })
    }
    return NextResponse.json({ appointment: data })
  } catch (error) { return apiError(error) }
}
