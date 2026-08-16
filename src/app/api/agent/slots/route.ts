import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import {rejectTeamActor} from '@/lib/agent-actor'
import { liberarHoldsPrevios } from '@/lib/agent-holds'
import { dateKeyInZone, formatInZone, formatTimeInZone, instanteDelNegocio } from '@/lib/timezone'
import { money } from '@/lib/money'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; serviceId?: string; from?: string; until?: string; clientId?: string; contactKey?: string }
  if (!body.businessId || !body.serviceId || !body.from || !body.until || !body.contactKey) return NextResponse.json({ error: 'Faltan datos obligatorios' }, { status: 400 })
  const db=createAdminClient()
  if(await rejectTeamActor(db,body.businessId,body.contactKey))return NextResponse.json({error:'El equipo solo puede consultar; usa el panel para gestionar reservas'},{status:403})
  const {data:business}=await db.from('businesses').select('settings,timezone,currency').eq('id',body.businessId).eq('active',true).maybeSingle()
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
      /*
       * Solo lo que el modelo usa. Antes se devolvía `...slot` entero y viajaban al prompt
       * `specialty_id`, `specialty_name`, `service_end` y `holdExpiresAt`, que ni se muestran al
       * cliente ni los pide ninguna herramienta: eran ~150 tokens por turno de puro relleno, y
       * cada token de entrada es tiempo de respuesta.
       *
       * Lo que queda es exactamente lo que necesita `crear_reserva` (professional_id, service_id,
       * service_start y holdId) más lo que se le enseña al cliente (nombres, día, hora, franja y
       * precio). Quitar cualquiera de estos rompe la reserva o la oferta.
       */
      held.push({
        professional_id: slot.professional_id,
        professional_name: slot.professional_name,
        service_id: slot.service_id,
        service_name: slot.service_name,
        service_start: slot.service_start,
        quoted_price: slot.quoted_price,
        /*
         * El precio YA escrito como lo lee el cliente. Misma decisión que `dia`, `hora` y
         * `franja`: lo que el modelo tenga que copiar, se le da copiado.
         *
         * Visto en producción justo después de darle un formato de salida al prompt: con solo
         * `quoted_price: 15000` delante, el agente escribió «$15000» en vez de «$15.000».
         * Formatear miles es aritmética de presentación, y el modelo no tiene por qué acertarla.
         */
        precio: money(Number(slot.quoted_price ?? 0), business.currency || 'CLP'),
        holdId: result.data.id,
        fecha: dateKeyInZone(inicio, business.timezone),
        dia: formatInZone(inicio, business.timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
        hora,
        franja: Number(hora.slice(0, 2)) < 13 ? 'mañana' : 'tarde',
      })
    }
  }
  return NextResponse.json({ slots: held, holdMinutes:15, zona: business.timezone })
}
