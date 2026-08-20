import type { SupabaseClient } from '@supabase/supabase-js'
import { findAgentTeamActor } from '@/lib/agent-actor'
import { money } from '@/lib/money'
import { cargarAvisoPendiente } from '@/lib/outbound-context'
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

/**
 * Cuántos mensajes del hilo se le dan al modelo. Seis son tres idas y vueltas.
 *
 * No es un número estético: el turno hace entre dos y cuatro llamadas al modelo y CADA una
 * reenvía la conversación entera. Medido en producción, un turno de reserva movía 6.500-8.200
 * tokens de entrada por llamada. Con tres idas y vueltas alcanza de sobra para entender de qué
 * se está hablando, y lo anterior ya está resumido en MEMORIA.
 */
const TURNOS_RECIENTES = 6

/**
 * Lo que se habló, leído de la base — la ÚNICA fuente de la conversación reciente.
 *
 * Antes esto lo ponía el nodo `Memoria reciente` de n8n (`memoryBufferWindow`), que guarda los
 * mensajes en la memoria del proceso. Dos problemas, los dos vistos en el diseño y no en una
 * teoría: un reinicio o un redespliegue de n8n borraba el hilo de todos los clientes a mitad de
 * conversación, y además el modelo recibía la conversación DOS veces (su buffer más el resumen
 * de `client_memory`), pagando los mismos tokens dos veces y pudiendo leer dos versiones
 * distintas de lo mismo.
 *
 * Ahora la conversación vive donde ya vivía de verdad: `conversations` + `messages`, que es lo
 * que se ve en el panel. Sobrevive a los reinicios porque nunca estuvo en un proceso.
 *
 * El reparto queda así, sin solaparse:
 * - CONVERSACION (esto) → lo que se dijo, literal y reciente.
 * - MEMORIA (`client_memory`) → lo que hay que recordar del cliente a largo plazo.
 */
async function cargarConversacion(
  db: SupabaseClient,
  datos: { businessId: string; phone: string; clientId: string | null },
) {
  let consulta = db.from('conversations').select('id')
    .eq('business_id', datos.businessId).eq('channel', 'WHATSAPP').neq('status', 'CLOSED')
  consulta = datos.clientId
    ? consulta.or(`client_id.eq.${datos.clientId},external_id.eq.${datos.phone}`)
    : consulta.eq('external_id', datos.phone)

  const { data: hilo } = await consulta.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (!hilo?.id) return []

  const { data } = await db.from('messages').select('sender,content,created_at')
    .eq('conversation_id', hilo.id).order('created_at', { ascending: false }).limit(TURNOS_RECIENTES)

  // De vuelta al orden en que se dijeron: el modelo lee una conversación, no una pila.
  return (data ?? []).reverse().map((fila) => ({
    quien: fila.sender === 'CLIENT' ? 'cliente' : fila.sender === 'AI' ? 'agen' : 'sistema',
    texto: String(fila.content ?? '').slice(0, 600),
    creadoEn: fila.created_at as string,
  }))
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
  const moneda = (negocio as { currency?: string }).currency || 'CLP'
  return {
    business: { ...negocio, maps_url: (negocio as { maps_url?: string | null }).maps_url ?? null },
    branches: sucursales.data,
    specialties: especialidades.data,
    /*
     * El precio YA escrito como lo lee el cliente, junto al número crudo.
     *
     * Con solo `price: 14000` delante, el agente contesta «cuesta $14000» — sin el punto de los
     * miles. Formatear moneda es presentación, y la presentación la resuelve el servidor: es la
     * misma decisión que ya estaba tomada para las fechas y las horas (CLAUDE.md §1).
     */
    services: (servicios.data ?? []).map((servicio) => ({
      ...servicio,
      precio: money(Number((servicio as { price?: number }).price ?? 0), moneda),
    })),
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
  datos: { businessId: string; phone: string; message?: string | null },
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

  // Segunda oleada, y solo si hace falta: las dos cosas cuelgan del id del cliente, pero no
  // dependen entre sí, así que van juntas.
  let appointments: Array<Record<string, unknown>> = []
  let pendingNotice = null
  // El hilo no depende de que la persona sea cliente: alguien que escribe por primera vez
  // también tiene conversación, y perderla era justo perder el principio de todas.
  const recientePromesa = cargarConversacion(db, {
    businessId: datos.businessId, phone: datos.phone, clientId: cliente.data?.id ?? null,
  })
  if (cliente.data) {
    const [vigentes, aviso] = await Promise.all([
      db.from('appointments')
        .select('id,status,service_period,client_confirmed_at,professional:professionals(display_name),service:services(name)')
        .eq('business_id', datos.businessId).eq('client_id', cliente.data.id)
        .in('status', ['PENDING', 'CONFIRMED'])
        .overlaps('service_period', `[${new Date().toISOString()},${new Date(Date.now() + 90 * 86400000).toISOString()})`)
        .order('service_period').limit(5),
      // Lo último que el negocio le mandó por su cuenta y sigue esperando respuesta. Sin esto,
      // un "No" llega sin la pregunta y el agente contesta "¿a qué te refieres con no?".
      cargarAvisoPendiente(db, { businessId: datos.businessId, clientId: cliente.data.id, phone: datos.phone, timezone, message: datos.message }),
    ])
    appointments = formatearReservas(vigentes.data ?? [], timezone)
    pendingNotice = aviso
  }

  return {
    ...catalogo,
    known: Boolean(cliente.data),
    actorType: 'CLIENT',
    client: cliente.data,
    appointments,
    pendingNotice,
    recent: await recientePromesa,
    timezone,
  }
}
