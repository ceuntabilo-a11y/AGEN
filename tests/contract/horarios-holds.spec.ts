import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { liberarHoldsPrevios } from '@/lib/agent-holds'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Cada búsqueda de horarios aparta hasta 3 cupos por 15 minutos. Una consulta repetida —el
 * cliente vuelve a preguntar, el modelo reintenta la tool, llega un mensaje duplicado— no
 * puede ir dejando apartados vivos: bloquearían cupos para todo el resto.
 */

const NEGOCIO = 'negocio-1'
const TELEFONO = '+56911112222'

let falso: SupabaseFalso
let db: SupabaseClient

const hold = (id: string, extra: Record<string, unknown> = {}) => ({
  id, business_id: NEGOCIO, professional_id: 'pro-1', service_id: 'serv-1',
  client_id: null, contact_key: TELEFONO, expires_at: '2026-08-12T12:15:00.000Z', ...extra,
})

const vivos = () => (falso.tablas.appointment_holds ?? []).map((item) => item.id)

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ appointment_holds: [] })
  db = createClient(falso.url, 'clave', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Una búsqueda repetida no acumula apartados', () => {
  test('los apartados anteriores del mismo teléfono se sueltan', async () => {
    falso.tablas.appointment_holds = [hold('h1'), hold('h2'), hold('h3')]

    const soltados = await liberarHoldsPrevios(db, { businessId: NEGOCIO, contactKey: TELEFONO })

    expect(soltados).toBe(3)
    expect(vivos()).toEqual([])
  })

  test('el contacto que se registró a mitad de camino no deja apartados huérfanos', async () => {
    // Primera búsqueda sin cliente (aparta por teléfono), después se registra y busca de
    // nuevo: si solo se mirara client_id, los tres primeros quedaban bloqueando cupos.
    falso.tablas.appointment_holds = [
      hold('h-por-telefono'),
      hold('h-por-cliente', { client_id: 'cliente-1', contact_key: null }),
    ]

    await liberarHoldsPrevios(db, { businessId: NEGOCIO, clientId: 'cliente-1', contactKey: TELEFONO })

    expect(vivos(), 'ningún apartado del mismo contacto puede sobrevivir').toEqual([])
  })

  test('los apartados de otro contacto no se tocan', async () => {
    falso.tablas.appointment_holds = [
      hold('mio'),
      hold('ajeno', { contact_key: '+56999999999' }),
      hold('de-otro-cliente', { client_id: 'cliente-9', contact_key: null }),
    ]

    await liberarHoldsPrevios(db, { businessId: NEGOCIO, clientId: 'cliente-1', contactKey: TELEFONO })

    expect(vivos()).toEqual(['ajeno', 'de-otro-cliente'])
  })

  test('los apartados de otro negocio no se tocan', async () => {
    falso.tablas.appointment_holds = [hold('otro-negocio', { business_id: 'negocio-2' })]
    await liberarHoldsPrevios(db, { businessId: NEGOCIO, contactKey: TELEFONO })
    expect(vivos()).toEqual(['otro-negocio'])
  })

  test('sin identificador de contacto no se borra nada', async () => {
    falso.tablas.appointment_holds = [hold('h1')]
    expect(await liberarHoldsPrevios(db, { businessId: NEGOCIO, contactKey: '   ' })).toBe(0)
    expect(vivos()).toEqual(['h1'])
  })

  test('tres consultas seguidas dejan como mucho los apartados de la última', async () => {
    for (let consulta = 0; consulta < 3; consulta += 1) {
      await liberarHoldsPrevios(db, { businessId: NEGOCIO, contactKey: TELEFONO })
      falso.tablas.appointment_holds.push(hold(`c${consulta}-a`), hold(`c${consulta}-b`), hold(`c${consulta}-c`))
    }
    expect(vivos()).toEqual(['c2-a', 'c2-b', 'c2-c'])
  })
})
