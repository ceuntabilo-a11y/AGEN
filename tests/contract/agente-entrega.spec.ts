import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  MAXIMO_INTENTOS_ENVIO,
  guardarRespuestaPendiente,
  marcarRespuestaEnviada,
  marcarRespuestaFallida,
  reclamarRespuestasPendientes,
} from '@/lib/agent-reply-delivery'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Entrega durable de la respuesta del agente.
 *
 * Lo que se prueba acá es el rescate: si la ejecución de n8n muere después de que el agente
 * pensó la respuesta, esa respuesta no puede perderse — y al reintentarla no puede volver a
 * ejecutarse nada (ni modelo, ni tools, ni reservas): solo se reenvía el mismo texto.
 */

const NEGOCIO = 'negocio-1'
const TELEFONO = '+56911112222'
const CLAVE = { businessId: NEGOCIO, phone: TELEFONO, messageId: 'WA-1' }
const AHORA = new Date('2026-08-13T12:00:00.000Z')
const HACE_RATO = '2026-08-13T11:00:00.000Z'

let falso: SupabaseFalso
let db: SupabaseClient

const fila = (extra: Record<string, unknown> = {}) => ({
  id: 1, business_id: NEGOCIO, phone: TELEFONO, message_id: 'WA-1', content: 'Hola',
  consumed_at: HACE_RATO, created_at: HACE_RATO,
  reply_text: null, reply_sent_at: null, reply_attempts: 0, reply_claimed_at: null, reply_error: null,
  ...extra,
})

const guardada = () => falso.tablas.agent_inbox[0]
const reclamar = (opciones = {}) => reclamarRespuestasPendientes(db, { ahora: AHORA, ...opciones })

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ agent_inbox: [fila()] })
  db = createClient(falso.url, 'clave', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('La respuesta se guarda antes de intentar enviarla', () => {
  test('queda pendiente con el texto ya validado', async () => {
    const resultado = await guardarRespuestaPendiente(db, { ...CLAVE, texto: 'Tengo hora el lunes a las 10:00.' })

    expect(resultado).toEqual({ durable: true, guardada: true })
    expect(guardada().reply_text).toBe('Tengo hora el lunes a las 10:00.')
    expect(guardada().reply_sent_at).toBeNull()
    expect(guardada().reply_attempts).toBe(1)
  })

  test('si el envío sale, deja de estar pendiente para siempre', async () => {
    await guardarRespuestaPendiente(db, { ...CLAVE, texto: 'Listo' })
    await marcarRespuestaEnviada(db, CLAVE)

    expect(guardada().reply_sent_at).toBeTruthy()
    expect((await reclamar()).respuestas, 'una respuesta entregada no se reintenta jamás').toHaveLength(0)
  })

  test('si el envío falla, queda lista para reintentar con el motivo', async () => {
    await guardarRespuestaPendiente(db, { ...CLAVE, texto: 'Listo' })
    await marcarRespuestaFallida(db, CLAVE, 'evolution_502')

    expect(guardada().reply_error).toBe('evolution_502')
    expect(guardada().reply_claimed_at).toBeNull()
    expect((await reclamar()).respuestas).toHaveLength(1)
  })

  test('no se toca la respuesta de otro mensaje ni de otro negocio', async () => {
    falso.tablas.agent_inbox = [fila(), fila({ id: 2, message_id: 'WA-2' }), fila({ id: 3, business_id: 'otro' })]

    await guardarRespuestaPendiente(db, { ...CLAVE, texto: 'Solo para WA-1' })

    expect(falso.tablas.agent_inbox.filter((item) => item.reply_text).map((item) => item.id)).toEqual([1])
  })

  test('sin la migración aplicada el envío sigue, pero avisa que no hay rescate', async () => {
    falso.columnasDesconocidas = ['reply_text']

    const resultado = await guardarRespuestaPendiente(db, { ...CLAVE, texto: 'Listo' })

    expect(resultado).toEqual({ durable: false, guardada: false })
    expect((await reclamar()).durable).toBe(true)
  })
})

test.describe('Si la ejecución muere, otra pasada rescata la respuesta', () => {
  test('una respuesta guardada y nunca enviada se reclama', async () => {
    falso.tablas.agent_inbox = [fila({ reply_text: 'Tengo hora el lunes', reply_attempts: 1, reply_claimed_at: HACE_RATO })]

    const { respuestas } = await reclamar()

    expect(respuestas.map((item) => item.reply_text)).toEqual(['Tengo hora el lunes'])
    expect(guardada().reply_attempts, 'cada rescate cuenta como un intento').toBe(2)
  })

  test('dos pasadas simultáneas no se llevan la misma respuesta', async () => {
    falso.tablas.agent_inbox = [fila({ reply_text: 'Tengo hora el lunes', reply_attempts: 1, reply_claimed_at: null })]
    falso.retardoLectura = 40

    const [una, otra] = await Promise.all([reclamar(), reclamar()])

    const total = una.respuestas.length + otra.respuestas.length
    expect(total, 'dos pasadas mandarían la misma respuesta dos veces').toBe(1)
  })

  test('una respuesta recién guardada no se toca: la ejecución original sigue viva', async () => {
    falso.tablas.agent_inbox = [fila({ created_at: AHORA.toISOString(), reply_text: 'Recién guardada', reply_attempts: 1 })]

    expect((await reclamar()).respuestas).toHaveLength(0)
  })

  test('una respuesta reclamada hace un minuto por otra pasada no se roba', async () => {
    falso.tablas.agent_inbox = [fila({
      reply_text: 'En vuelo', reply_attempts: 1,
      reply_claimed_at: new Date(AHORA.getTime() - 60000).toISOString(),
    })]

    expect((await reclamar()).respuestas).toHaveLength(0)
  })

  test('con los intentos agotados se deja de reintentar', async () => {
    falso.tablas.agent_inbox = [fila({ reply_text: 'Nunca sale', reply_attempts: MAXIMO_INTENTOS_ENVIO, reply_claimed_at: null })]

    expect((await reclamar()).respuestas).toHaveLength(0)
  })

  test('el reintento repite EXACTAMENTE el mismo texto', async () => {
    falso.tablas.agent_inbox = [fila({ reply_text: 'Te espero el lunes a las 10:00.', reply_attempts: 1 })]

    const { respuestas } = await reclamar()

    expect(respuestas[0].reply_text).toBe('Te espero el lunes a las 10:00.')
    // El rescate solo lee y marca la bandeja: ninguna función de reservas se llama.
    expect(falso.rpc, 'un reintento no puede ejecutar tools ni mutar reservas').toEqual([])
    expect(falso.peticiones.every((item) => item.tabla === 'agent_inbox')).toBe(true)
  })

  test('tras rescatarla y entregarla, no vuelve a reclamarse', async () => {
    falso.tablas.agent_inbox = [fila({ reply_text: 'Listo', reply_attempts: 1 })]

    const { respuestas } = await reclamar()
    await marcarRespuestaEnviada(db, { businessId: NEGOCIO, phone: TELEFONO, messageId: respuestas[0].message_id })

    expect((await reclamar()).respuestas).toHaveLength(0)
  })

  test('sin la migración aplicada, el rescate no rompe nada', async () => {
    falso.columnasDesconocidas = ['reply_claimed_at']
    falso.tablas.agent_inbox = [fila({ reply_text: 'Listo', reply_attempts: 1 })]

    const resultado = await reclamar()

    expect(resultado.respuestas).toHaveLength(0)
  })
})
