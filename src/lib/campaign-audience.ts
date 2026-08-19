import { createAdminClient } from '@/lib/supabase-admin'
import { dateKeyInZone } from '@/lib/timezone'

export type Audience = {
  segment?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'BIRTHDAY'
  /** Busca por nombre, sin distinguir mayúsculas ni tildes exactas. */
  q?: string
  /** Asistió al menos una vez en los últimos N días. */
  visitedWithinDays?: number
  /** Días desde la última visita, rango cerrado. */
  daysSinceLastVisitMin?: number
  daysSinceLastVisitMax?: number
  /** Cuántas veces vino, contadas dentro de `visitCountWindowDays` (o de siempre, si no viene). */
  visitCountMin?: number
  visitCountMax?: number
  visitCountWindowDays?: number
}
type Client = { id: string; full_name: string; phone: string | null; email: string | null; birthday: string | null; marketing_unsubscribe_token?: string | null }
type Consentimiento = { channel: string; purpose: string; granted: boolean }
type ClienteConConsentimientos = Client & { communication_consents: Consentimiento[] | Consentimiento | null }

/** Un elegible trae los canales por los que SÍ se le puede escribir esta campaña. */
export type ClienteElegible = Client & { channels: Array<'WHATSAPP' | 'EMAIL'> }

const DIA_MS = 24 * 60 * 60 * 1000
const CANALES_CON_ENVIO_DIRECTO = ['WHATSAPP', 'EMAIL'] as const

function sinTildes(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** El inicio de un `tstzrange` guardado como texto, igual que en el resto del código del agente. */
function inicioDelRango(period: unknown): Date | null {
  const texto = String(period ?? '').replace(/[[\]()"]/g, '').split(',')[0]
  const fecha = texto ? new Date(texto) : null
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha : null
}

export async function resolveCampaignAudience(
  db: ReturnType<typeof createAdminClient>,
  businessId: string,
  campaign: { channel: string; audience: Audience | null },
): Promise<{ eligible: ClienteElegible[]; segment: string }> {
  const canalesPedidos = campaign.channel === 'BOTH' ? [...CANALES_CON_ENVIO_DIRECTO] : [campaign.channel]
  const audience = campaign.audience ?? {}
  const segment = (audience.segment ?? 'ALL').toUpperCase()
  const { data: business } = await db.from('businesses').select('timezone').eq('id', businessId).single()

  /*
   * Se trae a TODOS los clientes del negocio (no solo los consentidos por un canal) porque para
   * "BOTH" hace falta saber, cliente por cliente, cuál de los dos canales concedió: uno puede
   * tener WhatsApp y no correo, o al revés.
   */
  let clientsResult = await db
    .from('clients')
    .select('id,full_name,phone,email,birthday,marketing_unsubscribe_token,communication_consents(channel,purpose,granted)')
    .eq('business_id', businessId)
    .limit(5000)
  if (clientsResult.error) clientsResult = await db
    .from('clients')
    .select('id,full_name,phone,email,birthday,communication_consents(channel,purpose,granted)')
    .eq('business_id', businessId)
    .limit(5000) as typeof clientsResult
  const { data: clients, error: clientsError } = clientsResult
  if (clientsError) throw clientsError

  // Historial de visitas de TODO el negocio, una sola consulta: de ahí salen el segmento
  // ACTIVE/INACTIVE de siempre y los filtros nuevos (última visita, cuántas veces vino).
  const { data: visitas, error: visitasError } = await db
    .from('appointments')
    .select('client_id,service_period')
    .eq('business_id', businessId)
    .eq('status', 'COMPLETED')
    .limit(20000)
  if (visitasError) throw visitasError
  const visitasPorCliente = new Map<string, Date[]>()
  for (const visita of (visitas ?? []) as Array<{ client_id: string; service_period: unknown }>) {
    const inicio = inicioDelRango(visita.service_period)
    if (!inicio) continue
    const lista = visitasPorCliente.get(visita.client_id) ?? []
    lista.push(inicio)
    visitasPorCliente.set(visita.client_id, lista)
  }

  const ahora = Date.now()
  const currentMonth = Number(dateKeyInZone(new Date(), business?.timezone ?? 'UTC').slice(5, 7))
  const q = audience.q?.trim() ? sinTildes(audience.q.trim()) : null

  const eligible: ClienteElegible[] = []
  for (const cliente of ((clients ?? []) as ClienteConConsentimientos[])) {
    const consentimientos = Array.isArray(cliente.communication_consents)
      ? cliente.communication_consents
      : cliente.communication_consents ? [cliente.communication_consents] : []
    const tieneConsentimiento = (canal: string) => consentimientos.some((c) => c.channel === canal && c.purpose === 'MARKETING' && c.granted === true)

    const channels = canalesPedidos.filter((canal): canal is 'WHATSAPP' | 'EMAIL' => {
      if (canal === 'WHATSAPP') return Boolean(cliente.phone) && tieneConsentimiento('WHATSAPP')
      if (canal === 'EMAIL') return Boolean(cliente.email) && tieneConsentimiento('EMAIL')
      return false
    })
    if (!channels.length) continue

    if (q && !sinTildes(cliente.full_name ?? '').includes(q)) continue

    const visitasCliente = visitasPorCliente.get(cliente.id) ?? []
    const ultimaVisita = visitasCliente.length ? new Date(Math.max(...visitasCliente.map((fecha) => fecha.getTime()))) : null
    const diasDesdeUltimaVisita = ultimaVisita ? Math.floor((ahora - ultimaVisita.getTime()) / DIA_MS) : null

    if (segment === 'ACTIVE' && (diasDesdeUltimaVisita === null || diasDesdeUltimaVisita > 180)) continue
    if (segment === 'INACTIVE' && diasDesdeUltimaVisita !== null && diasDesdeUltimaVisita <= 180) continue
    if (segment === 'BIRTHDAY' && !(cliente.birthday && Number(cliente.birthday.slice(5, 7)) === currentMonth)) continue

    if (audience.visitedWithinDays && (diasDesdeUltimaVisita === null || diasDesdeUltimaVisita > audience.visitedWithinDays)) continue
    if (typeof audience.daysSinceLastVisitMin === 'number' && (diasDesdeUltimaVisita === null || diasDesdeUltimaVisita < audience.daysSinceLastVisitMin)) continue
    if (typeof audience.daysSinceLastVisitMax === 'number' && (diasDesdeUltimaVisita === null || diasDesdeUltimaVisita > audience.daysSinceLastVisitMax)) continue

    if (typeof audience.visitCountMin === 'number' || typeof audience.visitCountMax === 'number') {
      const ventanaMs = audience.visitCountWindowDays ? audience.visitCountWindowDays * DIA_MS : null
      const cuenta = ventanaMs ? visitasCliente.filter((fecha) => ahora - fecha.getTime() <= ventanaMs).length : visitasCliente.length
      if (typeof audience.visitCountMin === 'number' && cuenta < audience.visitCountMin) continue
      if (typeof audience.visitCountMax === 'number' && cuenta > audience.visitCountMax) continue
    }

    eligible.push({ id: cliente.id, full_name: cliente.full_name, phone: cliente.phone, email: cliente.email, birthday: cliente.birthday, marketing_unsubscribe_token: cliente.marketing_unsubscribe_token, channels })
  }

  return { eligible, segment }
}
