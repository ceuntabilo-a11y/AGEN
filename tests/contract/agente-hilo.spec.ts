import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { guardarHilo } from '@/lib/agent-thread'
import { separarResumenYTranscripcion } from '@/lib/client-memory'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * El hilo se guarda siempre, también cuando quien escribe todavía no es cliente: es
 * justamente la primera conversación, la que decide si esa persona reserva o no.
 */

const NEGOCIO = 'negocio-1'
const TELEFONO = '+56911112222'

let falso: SupabaseFalso
let db: SupabaseClient

const hilos = () => falso.tablas.conversations ?? []
const mensajes = () => falso.tablas.messages ?? []

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ conversations: [], messages: [] })
  db = createClient(falso.url, 'clave', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Un teléfono sin ficha también deja conversación', () => {
  test('se guarda el hilo con el teléfono como identificador', async () => {
    const { conversationId } = await guardarHilo(db, {
      businessId: NEGOCIO, clientId: null, channel: 'WHATSAPP', externalId: TELEFONO,
      message: '¿Cuánto sale el corte?', reply: 'Sale $18.000 y dura 45 minutos.',
    })

    expect(conversationId).toBeTruthy()
    expect(hilos()).toHaveLength(1)
    expect(hilos()[0].client_id).toBeNull()
    expect(hilos()[0].external_id).toBe(TELEFONO)
    expect(mensajes().map((item) => item.content)).toEqual(['¿Cuánto sale el corte?', 'Sale $18.000 y dura 45 minutos.'])
  })

  test('el segundo mensaje sigue el mismo hilo, no abre otro', async () => {
    const base = { businessId: NEGOCIO, clientId: null, channel: 'WHATSAPP', externalId: TELEFONO }
    await guardarHilo(db, { ...base, message: 'Hola', reply: 'Hola, ¿en qué te ayudo?' })
    await guardarHilo(db, { ...base, message: '¿Tienen hora mañana?', reply: 'Sí, a las 10:00.' })

    expect(hilos()).toHaveLength(1)
    expect(mensajes()).toHaveLength(4)
  })

  test('el hilo de otro teléfono no se mezcla', async () => {
    await guardarHilo(db, { businessId: NEGOCIO, clientId: null, channel: 'WHATSAPP', externalId: TELEFONO, message: 'Hola', reply: 'Hola' })
    await guardarHilo(db, { businessId: NEGOCIO, clientId: null, channel: 'WHATSAPP', externalId: '+56999999999', message: 'Hola', reply: 'Hola' })

    expect(hilos()).toHaveLength(2)
  })

  test('cuando la persona se registra, su hilo anterior queda enlazado a su ficha', async () => {
    const base = { businessId: NEGOCIO, channel: 'WHATSAPP', externalId: TELEFONO }
    await guardarHilo(db, { ...base, clientId: null, message: 'Hola', reply: 'Hola' })
    await guardarHilo(db, { ...base, clientId: 'cliente-1', message: 'Me llamo Ana', reply: 'Gracias, Ana.' })

    expect(hilos(), 'no puede quedar un hilo huérfano y otro nuevo').toHaveLength(1)
    expect(hilos()[0].client_id).toBe('cliente-1')
    expect(mensajes()).toHaveLength(4)
  })

  test('con ficha, el hilo se sigue reconociendo por cliente', async () => {
    const base = { businessId: NEGOCIO, clientId: 'cliente-1', channel: 'WHATSAPP', externalId: TELEFONO }
    await guardarHilo(db, { ...base, message: 'Hola', reply: 'Hola' })
    await guardarHilo(db, { ...base, message: 'Otra cosa', reply: 'Dime' })

    expect(hilos()).toHaveLength(1)
    expect(hilos()[0].client_id).toBe('cliente-1')
  })
})

/**
 * Memoria histórica: las filas anteriores a A3 tienen el resumen del modelo mezclado con la
 * transcripción literal que pegaba `/api/agent/interactions`. Esta función solo DIAGNOSTICA:
 * no se ejecuta ninguna limpieza automática sobre datos ya guardados.
 */
test.describe('Diagnóstico de la memoria mezclada (no toca nada)', () => {
  test('reconoce una fila mezclada y separa las dos partes', () => {
    const mezclado = 'Prefiere a Camila y es alérgica al amoníaco.\nCliente: Hola\nAgen: Hola, ¿en qué te ayudo?'
    const resultado = separarResumenYTranscripcion(mezclado)

    expect(resultado.mezclado).toBe(true)
    expect(resultado.resumen).toBe('Prefiere a Camila y es alérgica al amoníaco.')
    expect(resultado.transcripcion).toBe('Cliente: Hola\nAgen: Hola, ¿en qué te ayudo?')
  })

  test('una fila que es solo transcripción se reconoce y queda sin resumen', () => {
    const resultado = separarResumenYTranscripcion('Cliente: Hola\nAgen: Hola\nCliente: ¿Hay hora?\nAgen: Sí')

    expect(resultado.mezclado).toBe(true)
    expect(resultado.resumen).toBe('')
  })

  test('un resumen limpio no se toca', () => {
    const limpio = 'Prefiere a Camila. Cumple en marzo.'
    expect(separarResumenYTranscripcion(limpio)).toEqual({ mezclado: false, resumen: limpio, transcripcion: '' })
  })

  test('un resumen que menciona a un cliente no se confunde con una transcripción', () => {
    const limpio = 'La clienta avisó que llega tarde. Agenda flexible.'
    expect(separarResumenYTranscripcion(limpio).mezclado).toBe(false)
  })

  test('sin resumen no hay nada que diagnosticar', () => {
    expect(separarResumenYTranscripcion(null).mezclado).toBe(false)
    expect(separarResumenYTranscripcion('').resumen).toBe('')
  })
})
