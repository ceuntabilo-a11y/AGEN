import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { businessId } = await request.json() as { businessId?: string }
  if (!businessId) return NextResponse.json({ error: 'businessId es obligatorio' }, { status: 400 })
  const db = createAdminClient()
  const [{ data: specialties, error: specialtyError }, { data: services, error: serviceError }] = await Promise.all([
    db.from('specialties').select('id,name,slug,description,color').eq('business_id', businessId).eq('active', true).order('name'),
    db.from('services').select('id,name,description,duration_minutes,price,deposit_amount,specialty:specialties(id,name,slug)').eq('business_id', businessId).eq('active', true).order('name'),
  ])
  if (specialtyError || serviceError) return NextResponse.json({ error: 'No se pudo cargar el catálogo' }, { status: 500 })
  return NextResponse.json({ specialties, services })
}
