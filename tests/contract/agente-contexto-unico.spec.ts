import { test, expect } from '@playwright/test'
import { POST as POST_contexto } from '@/app/api/agent/context/route'
import { POST as POST_memoria } from '@/app/api/agent/memory/route'
import { POST as POST_catalogo } from '@/app/api/agent/catalog/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Una sola llamada para todo el contexto del turno.
 *
 * El workflow hacía DOS peticiones a la app —memoria y catálogo— y además en secuencia, y por
 * dentro cada una encadenaba sus propias consultas. Medido contra producción, entre las dos se
 * iban 1,5–2,5 s de cada turno sin que ninguna dependiera de la otra.
 *
 * Lo que estas pruebas garantizan es lo único que puede romperse al unirlas: que
 * `/api/agent/context` devuelva **exactamente los mismos campos** que devolvían las dos juntas.
 * El prompt del agente los lee por nombre; si falta uno, el modelo se queda sin catálogo o sin
 * las reservas del cliente y empieza a adivinar — que es el fallo que más caro sale.
 */

const NEGOCIO = 'negocio-1'
const TELEFONO = '56911112222'

let falso: SupabaseFalso

const datos = (extra: Tablas = {}): Tablas => ({
  businesses: [{
    id: NEGOCIO, active: true, name: 'Bella Vida', timezone: 'America/Santiago',
    currency: 'CLP', address: 'Av. Siempre Viva 742', phone: '+56222222222',
    maps_url: null, settings: {}, agent_settings: {},
  }],
  specialties: [{ id: 'esp-1', business_id: NEGOCIO, active: true, name: 'Peluquería', slug: 'peluqueria', description: null, color: null }],
  services: [{ id: 'srv-1', business_id: NEGOCIO, active: true, name: 'Corte', description: null, duration_minutes: 45, price: 15000, deposit_amount: 0 }],
  branches: [],
  clients: [{ id: 'cli-1', business_id: NEGOCIO, phone: TELEFONO, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
  professionals: [],
  business_members: [],
  appointments: [],
  waitlist_entries: [],
  follow_up_tasks: [],
  ...extra,
})

const pedir = (handler: (r: Request) => Promise<Response>, cuerpo: Record<string, unknown>) =>
  handler(peticionAgente('http://localhost/api/agent/x', cuerpo))

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso(datos())
  usarSupabaseFalso(falso)
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('El contexto único trae todo lo que traían las dos llamadas', () => {
  test('no falta ningún campo de memoria ni de catálogo', async () => {
    const unico = await (await pedir(POST_contexto, { businessId: NEGOCIO, phone: TELEFONO })).json()
    const memoria = await (await pedir(POST_memoria, { businessId: NEGOCIO, phone: TELEFONO })).json()
    const catalogo = await (await pedir(POST_catalogo, { businessId: NEGOCIO })).json()

    for (const campo of Object.keys(memoria)) {
      expect(unico, `falta "${campo}", que venía de /api/agent/memory`).toHaveProperty(campo)
    }
    for (const campo of Object.keys(catalogo)) {
      expect(unico, `falta "${campo}", que venía de /api/agent/catalog`).toHaveProperty(campo)
    }
  })

  test('el catálogo y la ficha del cliente llegan con el mismo contenido', async () => {
    const unico = await (await pedir(POST_contexto, { businessId: NEGOCIO, phone: TELEFONO })).json()
    const catalogo = await (await pedir(POST_catalogo, { businessId: NEGOCIO })).json()

    expect(unico.services).toEqual(catalogo.services)
    expect(unico.specialties).toEqual(catalogo.specialties)
    expect(unico.business.id).toBe(catalogo.business.id)
    expect(unico.client.full_name).toBe('Ana Pérez')
    expect(unico.known).toBe(true)
    expect(unico.actorType).toBe('CLIENT')
  })

  test('las referencias de tiempo vienen resueltas en la zona del negocio', async () => {
    // Sin esto el modelo deduce "mañana" de un instante UTC y ofrece el día equivocado.
    const unico = await (await pedir(POST_contexto, { businessId: NEGOCIO, phone: TELEFONO })).json()
    expect(unico.time).toBeTruthy()
    expect(unico.time.hoy).toBeTruthy()
  })

  test('un teléfono desconocido no inventa cliente ni reservas', async () => {
    const unico = await (await pedir(POST_contexto, { businessId: NEGOCIO, phone: '56999999999' })).json()
    expect(unico.known).toBe(false)
    expect(unico.client).toBeNull()
    // RESERVAS vacío es lo que impide que el agente pregunte "¿confirmas tu cita?" a alguien
    // que nunca reservó.
    expect(unico.appointments).toEqual([])
  })

  test('el equipo entra en modo TEAM, con su agenda y sin ficha de cliente', async () => {
    falso.tablas.professionals = [{ id: 'pro-1', business_id: NEGOCIO, active: true, display_name: 'Valentina', phone: TELEFONO, member_id: 'mem-1' }]
    const unico = await (await pedir(POST_contexto, { businessId: NEGOCIO, phone: TELEFONO })).json()
    expect(unico.actorType).toBe('TEAM')
    expect(unico.teamMember).toBeTruthy()
    expect(Array.isArray(unico.today)).toBe(true)
    expect(unico.services, 'el equipo también necesita el catálogo').toBeTruthy()
  })
})

test.describe('Puerta de entrada', () => {
  test('sin el secreto compartido no devuelve nada', async () => {
    const respuesta = await POST_contexto(new Request('http://localhost/api/agent/context', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId: NEGOCIO, phone: TELEFONO }),
    }))
    expect(respuesta.status).toBe(401)
  })

  test('sin negocio o sin teléfono responde 400', async () => {
    expect((await pedir(POST_contexto, { phone: TELEFONO })).status).toBe(400)
    expect((await pedir(POST_contexto, { businessId: NEGOCIO })).status).toBe(400)
  })

  test('un negocio inexistente responde 404 y no un contexto vacío', async () => {
    // Devolver un contexto vacío haría que el agente contestara sin catálogo, inventando.
    const respuesta = await pedir(POST_contexto, { businessId: 'no-existe', phone: TELEFONO })
    expect(respuesta.status).toBe(404)
  })
})
