import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { saveAgentMemory, touchClientMemory } from '@/lib/client-memory'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * A3 — un solo escritor para `client_memory.conversation_summary`.
 *
 * Había dos, con contenidos incompatibles:
 * - `guardar_memoria` (PUT /api/agent/memory) escribe el RESUMEN del modelo, reemplazándolo.
 * - `/api/agent/interactions` pegaba después la TRANSCRIPCIÓN literal del último turno.
 *
 * El resultado era un campo mitad resumen mitad transcripción, y cada escritor borraba lo
 * del otro. La transcripción ya se guarda entera en `conversations`/`messages`, así que la
 * fuente autoritativa del resumen es el modelo, y la interacción solo marca cuándo fue la
 * última conversación.
 */

const CLIENTE = 'cliente-1'
const RESUMEN = 'Prefiere a Camila. Alérgica al amoníaco. Le gusta el corte en capas.'

let falso: SupabaseFalso
let db: SupabaseClient

const memoria = () => falso.tablas.client_memory?.[0]
const escrituras = () => falso.peticiones.filter((item) => item.tabla === 'client_memory' && item.metodo !== 'GET')
const escribieronResumen = () => escrituras().filter((item) => 'conversation_summary' in ((item.cuerpo ?? {}) as Record<string, unknown>))

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ client_memory: [] })
  db = createClient(falso.url, 'clave-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('El resumen tiene un solo dueño', () => {
  test('guardar la interacción no reescribe el resumen del modelo', async () => {
    await saveAgentMemory(db, { clientId: CLIENTE, summary: RESUMEN })

    await touchClientMemory(db, { clientId: CLIENTE })

    expect(memoria()?.conversation_summary, 'el resumen no puede quedar mezclado con la transcripción').toBe(RESUMEN)
  })

  test('la interacción no escribe la columna del resumen en absoluto', async () => {
    await touchClientMemory(db, { clientId: CLIENTE })

    expect(escribieronResumen(), 'solo guardar_memoria puede escribir conversation_summary').toHaveLength(0)
  })

  test('la transcripción no termina dentro del resumen', async () => {
    await touchClientMemory(db, { clientId: CLIENTE })

    expect(String(memoria()?.conversation_summary ?? '')).not.toContain('Cliente: Hola')
    expect(String(memoria()?.conversation_summary ?? '')).not.toContain('Agen:')
  })

  test('varias interacciones seguidas no hacen crecer el resumen', async () => {
    await saveAgentMemory(db, { clientId: CLIENTE, summary: RESUMEN })
    for (let turno = 0; turno < 4; turno += 1) await touchClientMemory(db, { clientId: CLIENTE })
    expect(memoria()?.conversation_summary).toBe(RESUMEN)
  })
})

test.describe('Los datos del modelo no se pisan por una escritura vieja', () => {
  test('lo que guarda el modelo sobrevive a una interacción concurrente', async () => {
    // La interacción lee primero (retardo), el modelo escribe en el medio y la interacción
    // guarda después: es el "lost update" clásico entre dos escritores del mismo registro.
    falso.retardoLectura = 40

    await Promise.all([
      touchClientMemory(db, { clientId: CLIENTE }),
      saveAgentMemory(db, { clientId: CLIENTE, summary: RESUMEN, knownFacts: { alergia: 'amoníaco' }, lastIntent: 'RESERVAR' }),
    ])

    expect(memoria()?.conversation_summary).toBe(RESUMEN)
    expect(memoria()?.known_facts).toEqual({ alergia: 'amoníaco' })
    expect(memoria()?.last_intent).toBe('RESERVAR')
  })

  test('la interacción tampoco toca hechos, preferencias ni intención', async () => {
    await touchClientMemory(db, { clientId: CLIENTE })

    for (const escritura of escrituras()) {
      const cuerpo = (escritura.cuerpo ?? {}) as Record<string, unknown>
      expect(Object.keys(cuerpo).sort(), 'la interacción solo marca cuándo fue la última conversación')
        .toEqual(['client_id', 'last_interaction_at', 'updated_at'])
    }
  })
})

test.describe('Lo que ya funcionaba sigue funcionando', () => {
  test('la interacción deja registrada la última conversación', async () => {
    await touchClientMemory(db, { clientId: CLIENTE })

    expect(memoria()?.client_id).toBe(CLIENTE)
    expect(typeof memoria()?.last_interaction_at).toBe('string')
  })

  test('el modelo puede acumular hechos sin perder los anteriores', async () => {
    await saveAgentMemory(db, { clientId: CLIENTE, summary: RESUMEN, knownFacts: { alergia: 'amoníaco' } })
    await saveAgentMemory(db, { clientId: CLIENTE, summary: `${RESUMEN} Cumple en marzo.`, knownFacts: { cumple: 'marzo' } })

    expect(memoria()?.known_facts).toEqual({ alergia: 'amoníaco', cumple: 'marzo' })
    expect(memoria()?.conversation_summary).toContain('Cumple en marzo')
  })

  test('sin resumen nuevo, el modelo conserva el que ya había', async () => {
    await saveAgentMemory(db, { clientId: CLIENTE, summary: RESUMEN })
    await saveAgentMemory(db, { clientId: CLIENTE, lastIntent: 'CONSULTAR' })

    expect(memoria()?.conversation_summary).toBe(RESUMEN)
    expect(memoria()?.last_intent).toBe('CONSULTAR')
  })

  test('el resumen del modelo se recorta a 4000 caracteres', async () => {
    await saveAgentMemory(db, { clientId: CLIENTE, summary: 'a'.repeat(5000) })
    expect(String(memoria()?.conversation_summary)).toHaveLength(4000)
  })
})
