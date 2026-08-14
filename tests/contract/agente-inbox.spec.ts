import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { claimInboxGroup, registerInboxMessage } from '@/lib/agent-inbox'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Idempotencia de la bandeja del agente (`@/lib/agent-inbox`, usado por `/api/agent/inbox`).
 *
 * El reclamo decide QUIÉN contesta: si dos ejecuciones concurrentes obtienen `claim:true`
 * para el mismo grupo, el cliente recibe dos respuestas y el modelo corre dos veces (y puede
 * reservar dos veces). Un webhook duplicado, un reintento de n8n o un timeout seguido de
 * reintento producen exactamente ese entrelazado.
 */

const NEGOCIO = '4cb0d138-6180-4842-8a88-1f633b08de5c'
const TELEFONO = '+56911112222'

let falso: SupabaseFalso
let db: SupabaseClient

const fila = (messageId: string, content: string, minuto: number, consumido: string | null = null) => ({
  id: `inbox-${messageId}`,
  business_id: NEGOCIO,
  phone: TELEFONO,
  message_id: messageId,
  content,
  consumed_at: consumido,
  created_at: `2026-08-12T10:0${minuto}:00.000Z`,
})

const reclamar = (messageId: string) => claimInboxGroup(db, { businessId: NEGOCIO, phone: TELEFONO, messageId })
const pendientes = () => (falso.tablas.agent_inbox ?? []).filter((item) => !item.consumed_at).map((item) => item.message_id)

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ agent_inbox: [] })
  db = createClient(falso.url, 'clave-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('El reclamo del grupo es exclusivo', () => {
  test('dos ejecuciones concurrentes del MISMO mensaje: solo una contesta', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1)]
    // Ambas leen antes de que cualquiera escriba: es el entrelazado de un webhook duplicado.
    falso.retardoLectura = 40

    const [una, otra] = await Promise.all([reclamar('WA-1'), reclamar('WA-1')])

    expect([una.claim, otra.claim].filter(Boolean), 'solo una ejecución puede contestar el mismo mensaje').toHaveLength(1)
    expect([una.message, otra.message].filter(Boolean)).toEqual(['Hola'])
    expect(pendientes()).toEqual([])
  })

  test('tres ejecuciones concurrentes tampoco se multiplican', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1)]
    falso.retardoLectura = 40

    const resultados = await Promise.all([reclamar('WA-1'), reclamar('WA-1'), reclamar('WA-1')])
    expect(resultados.filter((item) => item.claim)).toHaveLength(1)
  })

  test('reintento después de un timeout: la segunda llamada ya no reclama', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1)]

    const primera = await reclamar('WA-1')
    const reintento = await reclamar('WA-1')

    expect(primera.claim).toBe(true)
    expect(reintento.claim).toBe(false)
    expect(reintento.message).toBeUndefined()
  })

  test('dos mensajes distintos a la vez: contesta el último, una sola vez', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1), fila('WA-2', '¿tienen hora mañana?', 2)]
    falso.retardoLectura = 40

    const [viejo, nuevo] = await Promise.all([reclamar('WA-1'), reclamar('WA-2')])

    expect(viejo.claim).toBe(false)
    expect(nuevo.claim).toBe(true)
    expect(nuevo.message).toBe('Hola\n¿tienen hora mañana?')
    expect(pendientes()).toEqual([])
  })
})

test.describe('El agrupado por debounce sigue funcionando', () => {
  test('el último mensaje se lleva todos los pendientes, en orden', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1), fila('WA-2', 'quiero una hora', 2), fila('WA-3', 'mañana', 3)]

    const resultado = await reclamar('WA-3')

    expect(resultado.claim).toBe(true)
    expect(resultado.message).toBe('Hola\nquiero una hora\nmañana')
    expect(pendientes()).toEqual([])
  })

  test('un mensaje que no es el último no reclama NI consume nada', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1), fila('WA-2', 'mañana', 2)]

    const resultado = await reclamar('WA-1')

    expect(resultado.claim).toBe(false)
    // Si consumiera, "Hola" se perdería para la ejecución que sí contesta.
    expect(pendientes()).toEqual(['WA-1', 'WA-2'])
  })

  test('lo ya consumido no se vuelve a entregar', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1, '2026-08-12T10:00:30.000Z'), fila('WA-2', 'mañana', 2)]

    const resultado = await reclamar('WA-2')

    expect(resultado.claim).toBe(true)
    expect(resultado.message).toBe('mañana')
  })

  test('sin mensajes pendientes no se reclama nada', async () => {
    expect((await reclamar('WA-1')).claim).toBe(false)
  })

  test('otro negocio o otro teléfono no se mezclan en el grupo', async () => {
    falso.tablas.agent_inbox = [
      { ...fila('WA-1', 'de otro negocio', 1), business_id: 'otro-negocio' },
      { ...fila('WA-2', 'de otro teléfono', 2), phone: '+56999999999' },
      fila('WA-3', 'mío', 3),
    ]

    const resultado = await reclamar('WA-3')

    expect(resultado.claim).toBe(true)
    expect(resultado.message).toBe('mío')
  })
})

test.describe('El registro del mensaje no duplica filas', () => {
  test('el mismo mensaje registrado dos veces deja una sola fila', async () => {
    const datos = { businessId: NEGOCIO, phone: TELEFONO, messageId: 'WA-1', content: 'Hola' }
    expect(await registerInboxMessage(db, datos)).toBe(true)
    expect(await registerInboxMessage(db, datos)).toBe(true)
    expect(falso.tablas.agent_inbox).toHaveLength(1)
  })

  test('registrar de nuevo un mensaje ya consumido no lo revive', async () => {
    falso.tablas.agent_inbox = [fila('WA-1', 'Hola', 1, '2026-08-12T10:00:30.000Z')]

    await registerInboxMessage(db, { businessId: NEGOCIO, phone: TELEFONO, messageId: 'WA-1', content: 'Hola' })

    expect(pendientes()).toEqual([])
    expect((await reclamar('WA-1')).claim).toBe(false)
  })
})
