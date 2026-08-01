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
    const { data, error } = await db.rpc('create_safe_appointment', { p_business_id: businessId, p_branch_id: body.branchId ?? null, p_client_id: body.clientId, p_professional_id: body.professionalId, p_service_id: body.serviceId, p_desired_start: body.desiredStart, p_source: 'ADMIN', p_notes: body.notes?.slice(0,1000) ?? null })
    if (error?.code === '23P01') return NextResponse.json({ error: error.message, conflict: true }, { status: 409 })
    if (error) throw error
    return NextResponse.json({ appointment: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}
