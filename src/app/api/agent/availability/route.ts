import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

type AvailabilityRequest = {
  businessId?: string
  serviceId?: string
  desiredStart?: string
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await request.json()) as AvailabilityRequest
  if (!body.businessId || !body.serviceId || !body.desiredStart) {
    return NextResponse.json({ error: 'businessId, serviceId y desiredStart son obligatorios' }, { status: 400 })
  }

  const desiredStart = new Date(body.desiredStart)
  if (Number.isNaN(desiredStart.getTime())) {
    return NextResponse.json({ error: 'desiredStart debe ser una fecha ISO válida' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('find_available_professionals', {
    p_business_id: body.businessId,
    p_service_id: body.serviceId,
    p_desired_start: desiredStart.toISOString(),
  })

  if (error) return NextResponse.json({ error: 'No se pudo consultar disponibilidad' }, { status: 500 })
  return NextResponse.json({ available: data.length > 0, slots: data })
}
