import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import {rejectTeamActor} from '@/lib/agent-actor'
import { registrarAviso } from '@/lib/observabilidad'
import { instanteDelNegocio } from '@/lib/timezone'

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

  const supabase = createAdminClient()

  /*
   * La hora se lee en la zona del NEGOCIO cuando el modelo no manda zona.
   *
   * Normalmente el modelo devuelve el `service_start` que le dio `buscar_horarios`, que ya
   * viene con zona; pero cuando la construye él, una hora sin zona se interpretaba en la del
   * proceso (UTC) y la reserva caía cuatro horas corrida. Misma guarda que en `/api/agent/slots`.
   */
  const { data: negocio } = await supabase.from('businesses').select('timezone').eq('id', body.businessId).maybeSingle()
  const desiredStart = instanteDelNegocio(body.desiredStart, negocio?.timezone ?? 'America/Santiago')
  if (!desiredStart || desiredStart.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'desiredStart debe ser una fecha ISO futura válida' }, { status: 400 })
  }

  if(await rejectTeamActor(supabase,body.businessId,body.actorPhone))return NextResponse.json({error:'El equipo solo puede consultar; usa el panel para gestionar reservas'},{status:403})
  const branchId=!body.branchId||body.branchId==='null'?null:body.branchId
  let holdId=body.holdId
  if(holdId){
    const {data:hold,error:holdError}=await supabase.from('appointment_holds')
      .select('id,business_id,professional_id,service_id,period,expires_at')
      .eq('id',holdId).eq('business_id',body.businessId)
      .eq('professional_id',body.professionalId).eq('service_id',body.serviceId).maybeSingle()
    if(holdError)return NextResponse.json({error:'No se pudo validar el apartado'},{status:500})

    /*
     * Apartado vencido: NO es motivo para fallar por sí solo.
     *
     * El apartado dura 15 minutos y una conversación de WhatsApp puede tardar más — el cliente
     * responde cuando puede. Antes, decir "sí, confirmo" pasados esos 15 minutos devolvía 409 y
     * el agente contestaba "hay un problema técnico" aunque el horario siguiera perfectamente
     * libre. Ahora se intenta apartar de nuevo el MISMO horario: si sigue libre, se reserva; si
     * de verdad se lo llevó otra persona, `create_slot_hold` no lo concede y ahí sí es 409.
     *
     * La garantía transaccional no cambia: se sigue reservando contra un apartado real, y
     * `confirm_held_appointment` revalida la disponibilidad dentro de su transacción.
     */
    if(!hold||new Date(hold.expires_at).getTime()<=Date.now()){
      const renovado=await supabase.rpc('create_slot_hold',{
        p_business_id:body.businessId,p_professional_id:body.professionalId,p_service_id:body.serviceId,
        p_desired_start:desiredStart.toISOString(),p_client_id:body.clientId,
        p_contact_key:body.actorPhone?.trim()||null,p_minutes:15,p_origin:'AI_AGENT',
      })
      if(renovado.error||!renovado.data){
        registrarAviso('agente_reserva_apartado_perdido',{businessId:body.businessId,motivo:hold?'vencido':'inexistente'})
        return NextResponse.json({error:'Ese horario acaba de ocuparse',conflict:true},{status:409})
      }
      registrarAviso('agente_reserva_apartado_renovado',{businessId:body.businessId})
      holdId=renovado.data.id
    }else{
      const {data:service}=await supabase.from('services').select('buffer_before_minutes').eq('id',body.serviceId).eq('business_id',body.businessId).maybeSingle()
      const occupiedStart=hold.period.replace(/[\[\]()"]/g,'').split(',')[0]
      const heldStart=new Date(new Date(occupiedStart).getTime()+Number(service?.buffer_before_minutes??0)*60000)
      if(Math.abs(heldStart.getTime()-desiredStart.getTime())>1000)return NextResponse.json({error:'El horario no corresponde al apartado',conflict:true},{status:409})
    }
  }
  const { data, error } = await supabase.rpc('confirm_held_appointment',{
    p_hold_id:holdId,p_client_id:body.clientId,p_branch_id:branchId,p_notes:body.notes?.slice(0,1000)??null,
  })

  if (error?.code === '23P01') {
    return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: 'No se pudo crear la reserva' }, { status: 500 })

  return NextResponse.json({ booked: true, appointment: data }, { status: 201 })
}
