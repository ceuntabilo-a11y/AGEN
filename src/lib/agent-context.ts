import type { SupabaseClient } from '@supabase/supabase-js'
import { findAgentTeamActor } from '@/lib/agent-actor'
import { dateKeyInZone, formatInZone, formatTimeInZone, referenciasTemporales, zonedDayRange } from '@/lib/timezone'

/**
 * Todo el contexto que el agente necesita para contestar un turno, en el menor tiempo posible.
 *
 * Antes esto eran **dos llamadas HTTP desde n8n** (`/api/agent/memory` y `/api/agent/catalog`)
 * que además corrían en secuencia, y dentro de cada una las consultas también se encadenaban:
 * actor → cliente → negocio → reservas por un lado, negocio → catálogo por el otro. Medido
 * contra producción, entre las dos se iban 1,5–2,5 s de cada turno, y ninguna dependía de la
 * otra.
 *
 * Acá se hace en **dos oleadas**: primero todo lo que solo necesita `businessId` o el teléfono,
 * y después lo único que depende de un resultado anterior (las reservas del cliente, que
 * necesitan su id). El resto es exactamente la misma información que antes, con la misma forma,
 * para que el prompt del agente no cambie.
 */

export type ContextoDelAgente = Record<string, unknown>

const ZONA_POR_DEFECTO = 'America/Santiago'

/** Reservas vigentes del cliente, ya formateadas en la zona del negocio. */
function formatearReservas(filas: Array<Record<string, unknown>>, timezone: string) {
  return filas.map((item) => {
    const periodo = String(item.service_period ?? '').replace(/[[\]()"]/g, '').split(',')[0]
    const profesional = item.professional as { display_name?: string } | null
    const servicio = item.service as { name?: string } | null
    return {
      appointmentId: item.id,
      status: item.status,
      confirmedByClient: Boolean(item.client_confirmed_at),
      date: formatInZone(periodo, timezone, { weekday: 'long', day: 'numeric', month: 'long' }),
      time: formatTimeInZone(periodo, timezone),
      serviceName: servicio?.name ?? null,
      professionalName: profesional?.display_name ?? null,
    }
  })
}

/**
 * El negocio, con respaldo si la columna `maps_url` todavía no existe.
 *
 * Compatibilidad de esquema (CLAUDE.md §5.7): la app puede estar desplegada antes que la
 * migración, y en ese caso pedir la columna tumba la consulta entera.
 */
async function cargarNegocio(db: SupabaseClient, businessId: string) {
  const conMapa = await db.from('businesses')
    .select('id,name,timezone,currency,address,phone,maps_url,settings,agent_settings')
    .eq('id', businessId).eq('active', true).maybeSingle()
  if (!conMapa.error) return conMapa.data

  const sinMapa = await db.from('businesses')
    .select('id,name,timezone,currency,address,phone,settings,agent_settings')
    .eq('id', businessId).eq('active', true).maybeSingle()
  return sinMapa.data
}

/** Catálogo publicable del negocio: lo que el agente puede ofrecer. */
export async function cargarCatalogo(db: SupabaseClient, businessId: string) {
  const [negocio, especialidades, servicios, sucursales] = await Promise.all([
    cargarNegocio(db, businessId),
    db.from('specialties').select('id,name,slug,description,color')
      .eq('business_id', businessId).eq('active', true).order('name'),
    db.from('services').select('id,name,description,duration_minutes,price,deposit_amount,specialty:specialties(id,name,slug)')
      .eq('business_id', businessId).eq('active', true).order('name'),
    db.from('branches').select('id,name,address,phone,timezone')
      .eq('business_id', businessId).eq('active', true).order('name'),
  ])

  if (!negocio) return { error: 'inexistente' as const }
  if (especialidades.error || servicios.error || sucursales.error) return { error: 'catalogo' as const }

  const timezone = (negocio as { timezone?: string }).timezone || ZONA_POR_DEFECTO
  return {
    business: { ...negocio, maps_url: (negocio as { maps_url?: string | null }).maps_url ?? null },
    branches: sucursales.data,
    specialties: especialidades.data,
    services: servicios.data,
    // El agente no debe deducir qué día es "mañana" a partir de un instante UTC: las fechas
    // relativas se calculan acá, en la zona real del negocio y respetando el horario de verano.
    time: referenciasTemporales(new Date(), timezone),
  }
}

/**
 * Contexto completo de un turno: quién escribe, qué recuerda el negocio de esa persona, qué
 * reservas tiene vigentes y qué puede ofrecerle.
 *
 * Devuelve exactamente los mismos campos que devolvían `/api/agent/memory` y
 * `/api/agent/catalog` juntos, porque la plantilla del prompt los lee por nombre.
 */
export async function cargarContexto(
  db: SupabaseClient,
  datos: { businessId: string; phone: string },
): Promise<{ error: 'inexistente' | 'catalogo' | 'agenda' } | ContextoDelAgente> {
  // Primera oleada: todo lo que solo necesita el negocio o el teléfono. Nada de esto depende
  // de nada, así que encadenarlo era tiempo regalado.
  const [catalogo, actor, cliente] = await Promise.all([
    cargarCatalogo(db, datos.businessId),
    findAgentTeamActor(db, datos.businessId, datos.phone),
    db.from('clients')
      .select('id,full_name,phone,email,birthday,notes,marketing_opt_in,client_memory(preferred_professional_id,preferred_service_id,preferences,known_facts,conversation_summary,last_intent,last_interaction_at)')
      .eq('business_id', datos.businessId).eq('phone', datos.phone).maybeSingle(),
  ])

  if ('error' in catalogo) return catalogo
  const timezone = (catalogo.business as { timezone?: string }).timezone || ZONA_POR_DEFECTO

  // Modo equipo: solo lectura, y lo que necesita es la agenda del día, no su ficha de cliente.
  if (actor) {
    const dia = dateKeyInZone(new Date(), timezone)
    const { from, until } = zonedDayRange(dia, timezone)
    let agenda = db.from('appointments')
      .select('id,status,service_period,client:clients(full_name,phone),professional:professionals(display_name),service:services(name)')
      .eq('business_id', datos.businessId)
      .overlaps('service_period', `[${from},${until})`)
      .not('status', 'eq', 'CANCELLED')
      .order('service_period')
    if (actor.professionalId) agenda = agenda.eq('professional_id', actor.professionalId)

    const [hoy, espera, seguimientos] = await Promise.all([
      agenda,
      db.from('waitlist_entries').select('id', { count: 'exact', head: true })
        .eq('business_id', datos.businessId).eq('status', 'WAITING'),
      db.from('follow_up_tasks').select('id', { count: 'exact', head: true })
        .eq('business_id', datos.businessId).eq('status', 'PENDING').lte('due_on', dia),
    ])
    if (hoy.error || espera.error || seguimientos.error) return { error: 'agenda' as const }

    return {
      ...catalogo,
      known: true,
      actorType: 'TEAM',
      teamMember: actor,
      today: hoy.data ?? [],
      waiting: espera.count ?? 0,
      followups: seguimientos.count ?? 0,
      timezone,
    }
  }

  // Segunda oleada, y solo si hace falta: las reservas cuelgan del id del cliente.
  let appointments: Array<Record<string, unknown>> = []
  if (cliente.data) {
    const { data: vigentes } = await db.from('appointments')
      .select('id,status,service_period,client_confirmed_at,professional:professionals(display_name),service:services(name)')
      .eq('business_id', datos.businessId).eq('client_id', cliente.data.id)
      .in('status', ['PENDING', 'CONFIRMED'])
      .overlaps('service_period', `[${new Date().toISOString()},${new Date(Date.now() + 90 * 86400000).toISOString()})`)
      .order('service_period').limit(5)
    appointments = formatearReservas(vigentes ?? [], timezone)
  }

  return {
    ...catalogo,
    known: Boolean(cliente.data),
    actorType: 'CLIENT',
    client: cliente.data,
    appointments,
    timezone,
  }
}
