import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { referenciasTemporales } from '@/lib/timezone'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { businessId } = await request.json() as { businessId?: string }
  if (!businessId) return NextResponse.json({ error: 'businessId es obligatorio' }, { status: 400 })
  const db = createAdminClient()
  let businessResult = await db.from('businesses').select('id,name,timezone,currency,address,phone,maps_url,settings,agent_settings').eq('id',businessId).eq('active',true).maybeSingle()
  if (businessResult.error) businessResult = await db.from('businesses').select('id,name,timezone,currency,address,phone,settings,agent_settings').eq('id',businessId).eq('active',true).maybeSingle() as typeof businessResult
  const [{ data: specialties, error: specialtyError }, { data: services, error: serviceError }, { data: branches, error: branchError }] = await Promise.all([
    db.from('specialties').select('id,name,slug,description,color').eq('business_id', businessId).eq('active', true).order('name'),
    db.from('services').select('id,name,description,duration_minutes,price,deposit_amount,specialty:specialties(id,name,slug)').eq('business_id', businessId).eq('active', true).order('name'),
    db.from('branches').select('id,name,address,phone,timezone').eq('business_id',businessId).eq('active',true).order('name'),
  ])
  if (!businessResult.data) return NextResponse.json({ error: 'Negocio inexistente o inactivo' }, { status: 404 })
  if (specialtyError || serviceError || branchError) return NextResponse.json({ error: 'No se pudo cargar el catálogo' }, { status: 500 })
  // El agente no debe deducir qué día es "mañana" a partir de un instante UTC: las fechas
  // relativas se calculan acá, en la zona real del negocio y respetando el horario de verano.
  const time = referenciasTemporales(new Date(), businessResult.data.timezone)
  return NextResponse.json({ business: { ...businessResult.data, maps_url: (businessResult.data as any).maps_url ?? null }, branches, specialties, services, time })
}
