import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

type BookingRequest = {
  businessId?: string
  branchId?: string | null
  clientId?: string
  professionalId?: string
  serviceId?: string
  desiredStart?: string
  notes?: string
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await request.json()) as BookingRequest
  if (!body.businessId || !body.clientId || !body.professionalId || !body.serviceId || !body.desiredStart) {
    return NextResponse.json({ error: 'Faltan datos obligatorios de la reserva' }, { status: 400 })
  }

  const desiredStart = new Date(body.desiredStart)
  if (Number.isNaN(desiredStart.getTime())) {
    return NextResponse.json({ error: 'desiredStart debe ser una fecha ISO válida' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('create_safe_appointment', {
    p_business_id: body.businessId,
    p_branch_id: !body.branchId || body.branchId === 'null' ? null : body.branchId,
    p_client_id: body.clientId,
    p_professional_id: body.professionalId,
    p_service_id: body.serviceId,
    p_desired_start: desiredStart.toISOString(),
    p_source: 'AI_AGENT',
    p_notes: body.notes?.slice(0, 1000) ?? null,
  })

  if (error?.code === '23P01') {
    return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: 'No se pudo crear la reserva' }, { status: 500 })

  return NextResponse.json({ booked: true, appointment: data }, { status: 201 })
}
