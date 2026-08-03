import { NextResponse } from 'next/server'
import { requireClientContext } from '@/lib/client-context'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET(){
  try{
    const {db,businessId,clientId}=await requireClientContext()
    const [appointments,business]=await Promise.all([
      db.from('appointments').select('id,status,service_period,quoted_price,deposit_paid,professional:professionals(id,display_name,color),service:services(id,name),branch:branches(id,name,address)').eq('business_id',businessId).eq('client_id',clientId).order('service_period',{ascending:false}),
      db.from('businesses').select('timezone,settings').eq('id',businessId).single(),
    ])
    if(appointments.error||business.error)throw appointments.error||business.error
    return NextResponse.json({appointments:appointments.data,timezone:business.data.timezone,settings:business.data.settings})
  }catch(error){return apiError(error)}
}

export async function PATCH(request: Request) {
  try {
    const { db, clientId, businessId } = await requireClientContext()
    const body = await request.json() as { appointmentId?: string; action?: 'confirm'|'cancel'|'reschedule'; newStart?: string }
    if (!body.appointmentId || !body.action) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

    const [{ data: appointment, error: appointmentError }, { data: business, error: businessError }] = await Promise.all([
      db.from('appointments').select('id,status,service_period').eq('id',body.appointmentId).eq('client_id',clientId).eq('business_id',businessId).maybeSingle(),
      db.from('businesses').select('settings').eq('id',businessId).single(),
    ])
    if (appointmentError || businessError) throw appointmentError || businessError
    if (!appointment) return NextResponse.json({ error: 'Reserva inexistente' }, { status: 404 })
    if (['COMPLETED','CANCELLED','NO_SHOW','IN_PROGRESS'].includes(appointment.status)) return NextResponse.json({ error: 'Esta reserva ya no admite cambios' }, { status: 409 })

    if(body.action==='confirm'){
      if(appointment.status==='CONFIRMED')return NextResponse.json({appointment})
      if(appointment.status!=='PENDING')return NextResponse.json({error:'Esta reserva no se puede confirmar'},{status:409})
      const {data,error}=await db.from('appointments').update({status:'CONFIRMED',updated_at:new Date().toISOString()}).eq('id',body.appointmentId).eq('client_id',clientId).eq('business_id',businessId).eq('status','PENDING').select().maybeSingle()
      if(error)throw error
      if(!data)return NextResponse.json({error:'La reserva cambió; actualiza la pantalla'},{status:409})
      return NextResponse.json({appointment:data})
    }

    const settings = (business.settings ?? {}) as Record<string,unknown>
    if (body.action === 'cancel' && settings.allow_client_cancel === false) return NextResponse.json({ error: 'El negocio no permite cancelar desde el portal' }, { status: 403 })
    if (body.action === 'reschedule' && settings.allow_client_reschedule === false) return NextResponse.json({ error: 'El negocio no permite reagendar desde el portal' }, { status: 403 })

    const startText = appointment.service_period.replace(/[\[\]()"]/g,'').split(',')[0]
    const hoursUntil = (new Date(startText).getTime() - Date.now()) / 3_600_000
    const minimumHours = Number(settings.cancellation_hours ?? 24)
    if (hoursUntil < minimumHours) return NextResponse.json({ error: `Debes solicitar el cambio con al menos ${minimumHours} horas de anticipación` }, { status: 409 })

    if (body.action === 'reschedule') {
      const newStart = body.newStart ? new Date(body.newStart) : null
      if (!newStart || Number.isNaN(newStart.getTime()) || newStart.getTime() <= Date.now()) return NextResponse.json({ error: 'Nueva fecha inválida' }, { status: 400 })
    }

    const result = body.action === 'cancel'
      ? await db.rpc('cancel_safe_appointment',{p_appointment_id:body.appointmentId})
      : await db.rpc('reschedule_safe_appointment',{p_appointment_id:body.appointmentId,p_new_start:body.newStart})
    if (result.error?.code === '23P01') return NextResponse.json({ error:result.error.message, conflict:true }, { status:409 })
    if (result.error) return NextResponse.json({ error:result.error.message }, { status:400 })
    return NextResponse.json({ appointment:result.data })
  } catch(error) { return apiError(error) }
}
