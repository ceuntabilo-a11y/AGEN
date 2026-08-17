import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { rejectTeamActor } from '@/lib/agent-actor'
import { reservarConApartado } from '@/lib/agent-booking'

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

/**
 * Herramienta histórica de reserva del agente.
 *
 * Desde el router de intención, quien reserva es `/api/agent/act` (paso fijo de código). Esta
 * ruta se conserva porque la lógica es la misma —vive en `@/lib/agent-booking`— y porque un
 * despliegue a medias, o un workflow antiguo todavía importado, tiene que seguir funcionando.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await request.json()) as BookingRequest
  if (!body.businessId || !body.clientId || !body.professionalId || !body.serviceId || !body.desiredStart || !body.holdId || !body.actorPhone) {
    return NextResponse.json({ error: 'Faltan datos obligatorios de la reserva', motivo: 'DATO_INVALIDO' }, { status: 400 })
  }

  const supabase = createAdminClient()
  if (await rejectTeamActor(supabase, body.businessId, body.actorPhone)) {
    return NextResponse.json({ error: 'El equipo solo puede consultar; usa el panel para gestionar reservas', motivo: 'NO_AUTORIZADO' }, { status: 403 })
  }

  const resultado = await reservarConApartado(supabase, {
    businessId: body.businessId,
    clientId: body.clientId,
    professionalId: body.professionalId,
    serviceId: body.serviceId,
    desiredStart: body.desiredStart,
    holdId: body.holdId,
    branchId: body.branchId ?? null,
    notes: body.notes ?? null,
    contactKey: body.actorPhone,
  })

  if (!resultado.ok) {
    const cuerpo: Record<string, unknown> = { error: resultado.error, motivo: resultado.motivo }
    if (resultado.conflict) cuerpo.conflict = true
    return NextResponse.json(cuerpo, { status: resultado.estado })
  }

  return NextResponse.json({ booked: true, motivo: 'OK', appointment: resultado.appointment }, { status: 201 })
}
