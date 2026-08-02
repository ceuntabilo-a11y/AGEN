import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; serviceId?: string; from?: string; until?: string }
  if (!body.businessId || !body.serviceId || !body.from || !body.until) return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
  const from = new Date(body.from), until = new Date(body.until)
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) return NextResponse.json({ error: 'Ventana de búsqueda inválida' }, { status: 400 })
  if (until.getTime() - from.getTime() > 14 * 86400000) return NextResponse.json({ error: 'La ventana máxima es de 14 días' }, { status: 400 })
  const db=createAdminClient()
  const {data:business}=await db.from('businesses').select('settings').eq('id',body.businessId).eq('active',true).maybeSingle()
  if(!business)return NextResponse.json({error:'Negocio inexistente o inactivo'},{status:404})
  const interval=Math.min(120,Math.max(5,Number(business.settings?.booking_interval_minutes??15)))
  const { data, error } = await db.rpc('find_service_slots', { p_business_id: body.businessId, p_service_id: body.serviceId, p_from: from.toISOString(), p_until: until.toISOString(), p_interval_minutes: interval, p_limit: 20 })
  if (error) return NextResponse.json({ error: 'No se pudo buscar disponibilidad' }, { status: 500 })
  return NextResponse.json({ slots: data })
}
