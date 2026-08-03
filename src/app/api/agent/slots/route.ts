import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import {rejectTeamActor} from '@/lib/agent-actor'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; serviceId?: string; from?: string; until?: string; clientId?: string; contactKey?: string }
  if (!body.businessId || !body.serviceId || !body.from || !body.until || !body.contactKey) return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
  const from = new Date(body.from), until = new Date(body.until)
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) return NextResponse.json({ error: 'Ventana de búsqueda inválida' }, { status: 400 })
  if (until.getTime() - from.getTime() > 14 * 86400000) return NextResponse.json({ error: 'La ventana máxima es de 14 días' }, { status: 400 })
  const db=createAdminClient()
  if(await rejectTeamActor(db,body.businessId,body.contactKey))return NextResponse.json({error:'El equipo solo puede consultar; usa el panel para gestionar reservas'},{status:403})
  const {data:business}=await db.from('businesses').select('settings').eq('id',body.businessId).eq('active',true).maybeSingle()
  if(!business)return NextResponse.json({error:'Negocio inexistente o inactivo'},{status:404})
  const interval=Math.min(120,Math.max(5,Number(business.settings?.booking_interval_minutes??15)))
  if (body.clientId) await db.from('appointment_holds').delete().eq('business_id',body.businessId).eq('client_id',body.clientId)
  else if (body.contactKey?.trim()) await db.from('appointment_holds').delete().eq('business_id',body.businessId).eq('contact_key',body.contactKey.trim())
  const { data, error } = await db.rpc('find_service_slots', { p_business_id: body.businessId, p_service_id: body.serviceId, p_from: from.toISOString(), p_until: until.toISOString(), p_interval_minutes: interval, p_limit: 8 })
  if (error) return NextResponse.json({ error: 'No se pudo buscar disponibilidad' }, { status: 500 })
  const held=[]
  for(const slot of data??[]){
    if(held.length>=3)break
    const result=await db.rpc('create_slot_hold',{
      p_business_id:body.businessId,p_professional_id:slot.professional_id,p_service_id:body.serviceId,
      p_desired_start:slot.service_start,p_client_id:body.clientId??null,p_contact_key:body.contactKey?.trim()||null,
      p_minutes:15,p_origin:'AI_AGENT',
    })
    if(!result.error&&result.data)held.push({...slot,holdId:result.data.id,holdExpiresAt:result.data.expires_at})
  }
  return NextResponse.json({ slots: held, holdMinutes:15 })
}
