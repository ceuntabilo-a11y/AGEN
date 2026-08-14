import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { campanaAtascada, claimCampaignForSending, destinatariosYaEnviados, markCampaignSent, restoreCampaignStatus } from '@/lib/campaigns'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Un envío de campaña se le manda a TODA la audiencia. Dos peticiones concurrentes (doble
 * clic, pestaña duplicada, reintento del navegador) no pueden arrancar dos envíos, y una
 * campaña ya enviada no puede volver a salir por un clic de más.
 */

const NEGOCIO = 'negocio-1'

let falso: SupabaseFalso
let db: SupabaseClient

const campana = (estado: string) => ({ id: 'camp-1', business_id: NEGOCIO, name: 'Promo agosto', channel: 'WHATSAPP', content: 'Hola', status: estado, sent_at: null, sending_since: null })
const reclamar = () => claimCampaignForSending(db, { businessId: NEGOCIO, campaignId: 'camp-1' })
const estado = () => falso.tablas.campaigns[0]?.status

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ campaigns: [campana('DRAFT')], campaign_recipients: [] })
  db = createClient(falso.url, 'clave-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Solo una petición puede iniciar el envío', () => {
  test('dos peticiones concurrentes: una sola arranca', async () => {
    // Ambas leen la campaña antes de que ninguna la marque: es el doble clic real.
    falso.retardoLectura = 40

    const [una, otra] = await Promise.all([reclamar(), reclamar()])

    expect([una.claimed, otra.claimed].filter(Boolean), 'dos envíos a toda la audiencia').toHaveLength(1)
    expect(estado()).toBe('SENDING')
  })

  test('cinco peticiones concurrentes tampoco se cuelan', async () => {
    falso.retardoLectura = 40
    const resultados = await Promise.all([reclamar(), reclamar(), reclamar(), reclamar(), reclamar()])
    expect(resultados.filter((item) => item.claimed)).toHaveLength(1)
  })

  test('mientras está en curso, otra petición no reclama', async () => {
    falso.tablas.campaigns = [campana('SENDING')]
    const resultado = await reclamar()
    expect(resultado).toEqual({ claimed: false, motivo: 'en_proceso' })
  })
})

test.describe('Una campaña ya enviada no se reenvía', () => {
  test('el estado SENT bloquea un envío nuevo', async () => {
    falso.tablas.campaigns = [campana('SENT')]
    const resultado = await reclamar()
    expect(resultado, 'un clic de más reenviaría la campaña a toda la audiencia').toEqual({ claimed: false, motivo: 'ya_enviada' })
    expect(estado()).toBe('SENT')
  })

  test('después de un envío completo, reintentar tampoco reenvía', async () => {
    const primera = await reclamar()
    expect(primera.claimed).toBe(true)
    await markCampaignSent(db, 'camp-1')

    const reintento = await reclamar()

    expect(reintento).toEqual({ claimed: false, motivo: 'ya_enviada' })
    expect(estado()).toBe('SENT')
  })

  test('una campaña cancelada tampoco se envía', async () => {
    falso.tablas.campaigns = [campana('CANCELLED')]
    expect(await reclamar()).toEqual({ claimed: false, motivo: 'no_enviable' })
  })

  test('una campaña de otro negocio no se alcanza', async () => {
    expect(await claimCampaignForSending(db, { businessId: 'otro-negocio', campaignId: 'camp-1' })).toEqual({ claimed: false, motivo: 'inexistente' })
  })
})

test.describe('Una campaña cortada a la mitad se puede retomar sin repetir a nadie', () => {
  test('SENDING no se retoma sola, pero sí si se pide explícitamente', async () => {
    falso.tablas.campaigns = [campana('SENDING')]

    expect(await reclamar()).toEqual({ claimed: false, motivo: 'en_proceso' })
    const retomada = await claimCampaignForSending(db, { businessId: NEGOCIO, campaignId: 'camp-1', reanudar: true })
    expect(retomada.claimed, 'una campaña trabada tiene que poder reanudarse').toBe(true)
  })

  test('al reanudar se sabe a quién ya se le envió', async () => {
    falso.tablas.campaigns = [campana('SENDING')]
    falso.tablas.campaign_recipients = [
      { id: 1, campaign_id: 'camp-1', client_id: 'cliente-A', status: 'SENT', sent_at: '2026-08-12T10:00:00.000Z' },
      { id: 2, campaign_id: 'camp-1', client_id: 'cliente-B', status: 'PENDING', sent_at: null },
      { id: 3, campaign_id: 'camp-1', client_id: 'cliente-C', status: 'FAILED', sent_at: null },
    ]

    const yaEnviados = await destinatariosYaEnviados(db, 'camp-1')

    expect(yaEnviados.has('cliente-A'), 'quien ya recibió la campaña no puede recibirla otra vez').toBe(true)
    expect(yaEnviados.has('cliente-B')).toBe(false)
    expect(yaEnviados.has('cliente-C')).toBe(false)
  })

  test('los destinatarios de otra campaña no se mezclan', async () => {
    falso.tablas.campaign_recipients = [{ id: 1, campaign_id: 'otra', client_id: 'cliente-A', status: 'SENT', sent_at: null }]
    expect((await destinatariosYaEnviados(db, 'camp-1')).size).toBe(0)
  })

  test('al tomarla se registra cuándo empezó el envío', async () => {
    const reclamo = await reclamar()
    expect(reclamo.claimed).toBe(true)
    expect(falso.tablas.campaigns[0].sending_since, 'sin esto no se puede saber si quedó atascada').toBeTruthy()
  })

  test('se detecta una campaña atascada y no una que acaba de arrancar', () => {
    const ahora = new Date('2026-08-13T12:00:00.000Z')
    const haceUnRato = new Date(ahora.getTime() - 40 * 60000).toISOString()
    const reciente = new Date(ahora.getTime() - 60000).toISOString()

    expect(campanaAtascada({ status: 'SENDING', sending_since: haceUnRato }, { ahora })).toBe(true)
    expect(campanaAtascada({ status: 'SENDING', sending_since: reciente }, { ahora })).toBe(false)
    expect(campanaAtascada({ status: 'SENT', sending_since: haceUnRato }, { ahora })).toBe(false)
    // Sin la migración aplicada no se inventa un diagnóstico.
    expect(campanaAtascada({ status: 'SENDING', sending_since: null }, { ahora })).toBe(false)
  })

  test('al terminar deja de figurar como en curso', async () => {
    await reclamar()
    await markCampaignSent(db, 'camp-1')
    expect(falso.tablas.campaigns[0].sending_since).toBeNull()
    expect(campanaAtascada(falso.tablas.campaigns[0] as { status: string; sending_since: string | null })).toBe(false)
  })

  test('sin la migración aplicada se puede enviar igual', async () => {
    falso.columnasDesconocidas = ['sending_since']

    const reclamo = await reclamar()

    expect(reclamo.claimed, 'la columna nueva no puede impedir un envío').toBe(true)
    expect(estado()).toBe('SENDING')
  })

  test('una campaña ya enviada no se puede reanudar', async () => {
    falso.tablas.campaigns = [campana('SENT')]
    const intento = await claimCampaignForSending(db, { businessId: NEGOCIO, campaignId: 'camp-1', reanudar: true })
    expect(intento).toEqual({ claimed: false, motivo: 'ya_enviada' })
  })
})

test.describe('Lo que se reclama se puede devolver', () => {
  test('una campaña programada se reclama y se restaura a SCHEDULED', async () => {
    falso.tablas.campaigns = [campana('SCHEDULED')]

    const reclamo = await reclamar()
    expect(reclamo.claimed).toBe(true)
    expect(reclamo.claimed && reclamo.estadoPrevio).toBe('SCHEDULED')

    // Es lo que hace la ruta cuando no puede empezar (por ejemplo, sin clave de Resend):
    // devolver la campaña a su estado y no dejarla trabada en SENDING para siempre.
    await restoreCampaignStatus(db, 'camp-1', 'SCHEDULED')
    expect(estado()).toBe('SCHEDULED')
    expect((await reclamar()).claimed, 'tras restaurar, se tiene que poder reintentar').toBe(true)
  })

  test('el reclamo devuelve los datos de la campaña para el envío', async () => {
    const reclamo = await reclamar()
    expect(reclamo.claimed && reclamo.campaign.channel).toBe('WHATSAPP')
    expect(reclamo.claimed && reclamo.campaign.content).toBe('Hola')
  })
})
