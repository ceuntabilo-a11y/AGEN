import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveCampaignAudience } from '@/lib/campaign-audience'
import { destinatarioKey, destinatariosYaEnviadosPorCanal, faltaColumna } from '@/lib/campaigns'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Filtros de CRM en la audiencia de marketing y el envío por WhatsApp y correo a la vez
 * (Tanda 3). `resolveCampaignAudience` es la única puerta: la usan tanto el contador que ve el
 * dueño al armar la campaña como el envío real.
 */

const NEGOCIO = 'negocio-1'
const HOY = Date.now()
const diasAtras = (n: number) => new Date(HOY - n * 86400000).toISOString()

const consentWhatsapp = { channel: 'WHATSAPP', purpose: 'MARKETING', granted: true }
const consentEmail = { channel: 'EMAIL', purpose: 'MARKETING', granted: true }

const cliente = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, business_id: NEGOCIO, full_name: nombre, phone: `+56911${id}`, email: `${id}@test.cl`,
  birthday: null, marketing_unsubscribe_token: `tok-${id}`,
  communication_consents: [consentWhatsapp, consentEmail],
  ...extra,
})

const visita = (clientId: string, hace: number) => ({
  client_id: clientId, business_id: NEGOCIO, status: 'COMPLETED',
  service_period: `[${diasAtras(hace)},${diasAtras(hace)})`,
})

let falso: SupabaseFalso
let db: SupabaseClient

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({
    businesses: [{ id: NEGOCIO, timezone: 'America/Santiago' }],
    clients: [], appointments: [], campaigns: [], campaign_recipients: [],
  })
  db = createClient(falso.url, 'clave-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Buscar por nombre', () => {
  test('filtra sin distinguir mayúsculas ni tildes', async () => {
    falso.tablas.clients = [cliente('a', 'María José'), cliente('b', 'Pedro')]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, { channel: 'WHATSAPP', audience: { q: 'maria jose' } })
    expect(eligible.map((c) => c.id)).toEqual(['a'])
  })
})

test.describe('Asistió en los últimos N días', () => {
  test('deja fuera a quien no ha vuelto en la ventana pedida', async () => {
    falso.tablas.clients = [cliente('reciente', 'Reciente'), cliente('vieja', 'Vieja')]
    falso.tablas.appointments = [visita('reciente', 3), visita('vieja', 40)]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, { channel: 'WHATSAPP', audience: { visitedWithinDays: 7 } })
    expect(eligible.map((c) => c.id)).toEqual(['reciente'])
  })

  test('quien nunca vino no cuenta como "asistió"', async () => {
    falso.tablas.clients = [cliente('nunca', 'Nunca vino')]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, { channel: 'WHATSAPP', audience: { visitedWithinDays: 30 } })
    expect(eligible).toHaveLength(0)
  })
})

test.describe('Días desde la última visita', () => {
  test('un rango mínimo y máximo acota por inactividad', async () => {
    falso.tablas.clients = [cliente('muy-reciente', 'A'), cliente('justo', 'B'), cliente('muy-vieja', 'C')]
    falso.tablas.appointments = [visita('muy-reciente', 2), visita('justo', 20), visita('muy-vieja', 90)]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, {
      channel: 'WHATSAPP', audience: { daysSinceLastVisitMin: 10, daysSinceLastVisitMax: 30 },
    })
    expect(eligible.map((c) => c.id)).toEqual(['justo'])
  })
})

test.describe('Cuántas veces ha venido', () => {
  test('"vino 2 o 3 veces en los últimos 30 días" es visitCount + ventana', async () => {
    falso.tablas.clients = [cliente('dos', 'Dos visitas'), cliente('una', 'Una visita'), cliente('cuatro', 'Cuatro visitas')]
    falso.tablas.appointments = [
      visita('dos', 5), visita('dos', 20),
      visita('una', 10),
      visita('cuatro', 1), visita('cuatro', 5), visita('cuatro', 10), visita('cuatro', 15),
    ]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, {
      channel: 'WHATSAPP', audience: { visitCountMin: 2, visitCountMax: 3, visitCountWindowDays: 30 },
    })
    expect(eligible.map((c) => c.id)).toEqual(['dos'])
  })

  test('sin ventana, cuenta las visitas de siempre', async () => {
    falso.tablas.clients = [cliente('fiel', 'Fiel')]
    falso.tablas.appointments = [visita('fiel', 5), visita('fiel', 200), visita('fiel', 400)]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, { channel: 'WHATSAPP', audience: { visitCountMin: 3 } })
    expect(eligible.map((c) => c.id)).toEqual(['fiel'])
  })
})

test.describe('Enviar por WhatsApp y correo a la vez', () => {
  test('BOTH trae a quien tiene consentimiento de al menos uno de los dos canales', async () => {
    falso.tablas.clients = [
      cliente('los-dos', 'Los dos'),
      cliente('solo-wsp', 'Solo WhatsApp', { communication_consents: [consentWhatsapp] }),
      cliente('solo-mail', 'Solo correo', { communication_consents: [consentEmail] }),
      cliente('ninguno', 'Sin consentimiento', { communication_consents: [] }),
    ]
    const { eligible } = await resolveCampaignAudience(db, NEGOCIO, { channel: 'BOTH', audience: {} })
    const porId = Object.fromEntries(eligible.map((c) => [c.id, c.channels]))
    expect(porId['los-dos']?.sort()).toEqual(['EMAIL', 'WHATSAPP'])
    expect(porId['solo-wsp']).toEqual(['WHATSAPP'])
    expect(porId['solo-mail']).toEqual(['EMAIL'])
    expect(porId['ninguno']).toBeUndefined()
  })

  test('a quien ya se le mandó el WhatsApp pero no el correo, solo le falta el correo', async () => {
    falso.tablas.campaign_recipients = [
      { id: 1, campaign_id: 'camp-1', client_id: 'los-dos', channel: 'WHATSAPP', status: 'SENT', sent_at: diasAtras(0) },
    ]
    const yaEnviados = await destinatariosYaEnviadosPorCanal(db, 'camp-1')
    expect(yaEnviados.has(destinatarioKey('los-dos', 'WHATSAPP'))).toBe(true)
    expect(yaEnviados.has(destinatarioKey('los-dos', 'EMAIL')), 'el correo todavía no salió').toBe(false)
  })

  test('sin la migración aplicada, la columna channel se detecta como ausente', async () => {
    falso.columnasDesconocidas = ['channel']
    const prueba = await db.from('campaign_recipients').update({ channel: null }).eq('campaign_id', '00000000-0000-0000-0000-000000000000')
    expect(faltaColumna(prueba.error), 'el envío por los dos canales tiene que avisar, no romperse').toBe(true)
  })
})
