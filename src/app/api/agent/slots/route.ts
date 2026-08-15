import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import {rejectTeamActor} from '@/lib/agent-actor'
import { liberarHoldsPrevios } from '@/lib/agent-holds'
import { dateKeyInZone, formatInZone, formatTimeInZone, instanteDelNegocio } from '@/lib/timezone'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; serviceId?: string; from?: string; until?: string; clientId?: string; contactKey?: string }
  if (!body.businessId || !body.serviceId || !body.from || !body.until || !body.contactKey) return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
  const db=createAdminClient()
  if(await rejectTeamActor(db,body.businessId,body.contactKey))return NextResponse.json({error:'El equipo solo puede consultar; usa el panel para gestionar reservas'},{status:403})
  const {data:business}=await db.from('businesses').select('settings,timezone').eq('id',body.businessId).eq('active',true).maybeSingle()
  if(!business)return NextResponse.json({error:'Negocio inexistente o inactivo'},{status:404})

  /*
   * La ventana se lee en la zona del NEGOCIO cuando el modelo no manda zona.
   *
   * Pasó en producción: para "el martes en la tarde" mandó `from: "2026-08-18T13:00:00"`, sin
   * zona. `new Date()` lo interpretaba en la del proceso (UTC), así que se buscó de 09:00 a
   * 15:00 hora de Santiago y el cliente recibió "no hay horas en la tarde del martes" cuando
   * sí las había. Ver `instanteDelNegocio`.
   */
  const from = instanteDelNegocio(body.from, business.timezone), until = instanteDelNegocio(body.until, business.timezone)
  if (!from || !until || until <= from) return NextResponse.json({ error: 'Ventana de búsqueda inválida' }, { status: 400 })
  if (until.getTime() - from.getTime() > 14 * 86400000) return NextResponse.json({ error: 'La ventana máxima es de 14 días' }, { status: 400 })
  const interval=Math.min(120,Math.max(5,Number(business.settings?.booking_interval_minutes??15)))
  // Antes de apartar de nuevo se sueltan los apartados previos de ESTE contacto, por sus dos
  // claves: si solo se mirara una, una búsqueda repetida iría acumulando cupos bloqueados.
  await liberarHoldsPrevios(db, { businessId: body.businessId, clientId: body.clientId, contactKey: body.contactKey })
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
    if(!result.error&&result.data){
      /*
       * El día y la hora YA formateados en la zona del negocio.
       *
       * `service_start` viaja en UTC, y pedirle al modelo que lo convierta es pedirle que haga
       * aritmética de husos: unas veces sale bien y otras no. Visto en producción — con horarios
       * de las 09:00 locales (13:00 UTC) el agente le dijo al cliente "el martes 17 a las 13:00
       * en la tarde", y ni el día ni la hora ni la franja eran ciertos.
       *
       * Con `fecha`, `dia`, `hora` y `franja` resueltos acá, el modelo solo tiene que copiarlos.
       * Es la misma decisión que ya estaba tomada para las reservas del cliente en
       * `/api/agent/memory`, y la que manda `CLAUDE.md` §1: la zona la resuelve el servidor.
       */
      const inicio = new Date(slot.service_start)
      const hora = formatTimeInZone(inicio, business.timezone)
      held.push({
        ...slot,
        holdId: result.data.id,
        holdExpiresAt: result.data.expires_at,
        fecha: dateKeyInZone(inicio, business.timezone),
        dia: formatInZone(inicio, business.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
        hora,
        franja: Number(hora.slice(0, 2)) < 13 ? 'mañana' : 'tarde',
      })
    }
  }
  return NextResponse.json({ slots: held, holdMinutes:15, zona: business.timezone })
}
