import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { POST as LEADS } from '@/app/api/leads/route'
import { readPromo } from '@/lib/referrals'
import { levantarSupabaseFalso, usarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Tanda 8: invitar a otro dueño de negocio para que pida que lo contacten (no para que cree su
 * cuenta solo). `readPromo` decide si se muestra el premio; `/api/leads` es la puerta pública
 * (sin sesión) donde cae ese pedido.
 */

const NEGOCIO = 'negocio-1'
let falso: SupabaseFalso
let db: SupabaseClient

const pedirLead = (cuerpo: unknown) => LEADS(new Request('http://localhost/api/leads', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
}))

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({
    businesses: [{ id: NEGOCIO, active: true, referral_code: 'ABC12345' }],
    business_referrals: [], platform_settings: [],
  })
  db = createClient(falso.url, 'clave-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
  usarSupabaseFalso(falso)
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('readPromo — el premio se puede apagar sin tocar código', () => {
  test('sin la clave guardada, el premio está activo por defecto', async () => {
    const promo = await readPromo(db)
    expect(promo.enabled).toBe(true)
  })

  test('con referral_enabled en "false", el premio queda apagado', async () => {
    falso.tablas.platform_settings = [{ key: 'referral_enabled', value: 'false' }]
    const promo = await readPromo(db)
    expect(promo.enabled).toBe(false)
  })

  test('con referral_enabled en "true", el premio queda encendido', async () => {
    falso.tablas.platform_settings = [{ key: 'referral_enabled', value: 'true' }]
    const promo = await readPromo(db)
    expect(promo.enabled).toBe(true)
  })
})

test.describe('POST /api/leads — pedir que te contacten, sin crear ninguna cuenta', () => {
  test('guarda el pedido con nombre, negocio y teléfono', async () => {
    const respuesta = await pedirLead({ name: 'Ana', businessName: 'Salón Ana', phone: '+56911112222', referralCode: 'abc12345' })
    expect(respuesta.status).toBe(201)
    expect(falso.tablas.business_referrals).toHaveLength(1)
    const fila = falso.tablas.business_referrals[0]
    expect(fila.referrer_business_id).toBe(NEGOCIO)
    expect(fila.referred_phone).toBe('56911112222')
    expect(fila.status).toBe('PENDING')
  })

  test('sin teléfono no se guarda nada', async () => {
    const respuesta = await pedirLead({ businessName: 'Salón Ana' })
    expect(respuesta.status).toBe(400)
    expect(falso.tablas.business_referrals).toHaveLength(0)
  })

  test('sin nombre de negocio no se guarda nada', async () => {
    const respuesta = await pedirLead({ phone: '+56911112222' })
    expect(respuesta.status).toBe(400)
    expect(falso.tablas.business_referrals).toHaveLength(0)
  })

  test('un código que no corresponde a ningún negocio no bloquea el pedido: queda sin atribuir', async () => {
    const respuesta = await pedirLead({ businessName: 'Salón Ana', phone: '+56911112222', referralCode: 'NOEXISTE' })
    expect(respuesta.status).toBe(201)
    expect(falso.tablas.business_referrals[0].referrer_business_id ?? null).toBeNull()
  })

  test('sin ningún código, el pedido también queda sin atribuir, no se inventa un negocio', async () => {
    const respuesta = await pedirLead({ businessName: 'Salón Ana', phone: '+56911112222' })
    expect(respuesta.status).toBe(201)
    expect(falso.tablas.business_referrals[0].referrer_business_id ?? null).toBeNull()
  })
})
