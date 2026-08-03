import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import {rejectTeamActor} from '@/lib/agent-actor'

type BookingRequest = {
  businessId?: string
  branchId?: string | null
  clientId?: string
  professionalId?: string
  serviceId?: string
  desiredStart?: string
  holdId?: string
  notes?: string
  actorPhone?: string
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await request.json()) as BookingRequest
  if (!body.businessId || !body.clientId || !body.professionalId || !body.serviceId || !body.desiredStart || !body.holdId || !body.actorPhone) {
    return NextResponse.json({ error: 'Faltan datos obligatorios de la reserva' }, { status: 400 })
  }

  const desiredStart = new Date(body.desiredStart)
  if (Number.isNaN(desiredStart.getTime()) || desiredStart.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'desiredStart debe ser una fecha ISO futura válida' }, { status: 400 })
  }

  const supabase = createAdminClient()
  if(await rejectTeamActor(supabase,body.businessId,body.actorPhone))return NextResponse.json({error:'El equipo solo puede consultar; usa el panel para gestionar reservas'},{status:403})
  const branchId=!body.branchId||body.branchId==='null'?null:body.branchId
  if(body.holdId){
    const {data:hold,error:holdError}=await supabase.from('appointment_holds')
      .select('id,business_id,professional_id,service_id,period,expires_at')
      .eq('id',body.holdId).eq('business_id',body.businessId)
      .eq('professional_id',body.professionalId).eq('service_id',body.serviceId).maybeSingle()
    if(holdError)return NextResponse.json({error:'No se pudo validar el apartado'},{status:500})
    if(!hold||new Date(hold.expires_at).getTime()<=Date.now())return NextResponse.json({error:'El apartado no existe o ya venció',conflict:true},{status:409})
    const {data:service}=await supabase.from('services').select('buffer_before_minutes').eq('id',body.serviceId).eq('business_id',body.businessId).maybeSingle()
    const occupiedStart=hold.period.replace(/[\[\]()"]/g,'').split(',')[0]
    const heldStart=new Date(new Date(occupiedStart).getTime()+Number(service?.buffer_before_minutes??0)*60000)
    if(Math.abs(heldStart.getTime()-desiredStart.getTime())>1000)return NextResponse.json({error:'El horario no corresponde al apartado',conflict:true},{status:409})
  }
  const { data, error } = await supabase.rpc('confirm_held_appointment',{
    p_hold_id:body.holdId,p_client_id:body.clientId,p_branch_id:branchId,p_notes:body.notes?.slice(0,1000)??null,
  })

  if (error?.code === '23P01') {
    return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: 'No se pudo crear la reserva' }, { status: 500 })

  return NextResponse.json({ booked: true, appointment: data }, { status: 201 })
}
