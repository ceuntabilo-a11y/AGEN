import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MARCA_EN_VUELO, claimNotifications, contarAvisosAmbiguos, descartarAviso, marcarAvisoEnviado, reintentarAviso } from '@/lib/notification-dispatch'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Un aviso duplicado le llega al cliente como un segundo "recuerda tu hora de mañana".
 *
 * El caso que importa: el WhatsApp salió bien pero la escritura de `processed_at` falló.
 * Antes eso dejaba la fila sin procesar y, al caducar `claimed_at`, se reenviaba.
 */

let falso: SupabaseFalso
let db: SupabaseClient

const aviso = (id: number, extra: Record<string, unknown> = {}) => ({
  id, business_id: 'negocio-1', appointment_id: 'cita-1', client_id: 'cliente-1',
  event_type: 'REMINDER_24H', channel: 'WHATSAPP', payload: {},
  processed_at: null, claimed_at: null, attempts: 0, last_error: null,
  scheduled_at: '2026-08-12T10:00:00.000Z', ...extra,
})

/** La función SQL real: reclama lo vencido y sin procesar, subiendo el contador de intentos. */
const simularClaim = () => {
  falso.respuestasRpc.claim_due_notifications = (argumentos, tablas) => {
    const filas = (tablas.notification_outbox ?? [])
      .filter((fila) => !fila.processed_at && fila.attempts < 5)
      .slice(0, Number(argumentos.p_limit ?? 50))
    for (const fila of filas) { fila.attempts += 1; fila.claimed_at = '2026-08-12T12:00:00.000Z' }
    return filas.map((fila) => ({ ...fila }))
  }
}

const fila = (id: number) => (falso.tablas.notification_outbox ?? []).find((item) => item.id === id)

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ notification_outbox: [aviso(1)] })
  simularClaim()
  db = createClient(falso.url, 'clave', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Reclamar un aviso consume el intento', () => {
  test('al reclamarlo ya queda procesado, antes de intentar el envío', async () => {
    const { avisos } = await claimNotifications(db)

    expect(avisos.map((item) => item.id)).toEqual([1])
    expect(fila(1)?.processed_at, 'si se marca después del envío, un fallo de escritura duplica el aviso').toBeTruthy()
  })

  test('envío bien + fallo al cerrar: no se vuelve a reclamar', async () => {
    const { avisos } = await claimNotifications(db)
    // El envío salió, pero la escritura de cierre nunca ocurre (proceso muerto, red caída).
    expect(avisos).toHaveLength(1)

    // Pasa el tiempo y el siguiente ciclo vuelve a reclamar.
    if (fila(1)) fila(1)!.claimed_at = null
    const segundo = await claimNotifications(db)

    expect(segundo.avisos, 'el cliente recibiría el mismo aviso dos veces').toHaveLength(0)
  })

  test('dos ciclos seguidos no entregan el mismo aviso', async () => {
    const primero = await claimNotifications(db)
    await marcarAvisoEnviado(db, primero.avisos[0].id)
    const segundo = await claimNotifications(db)

    expect(primero.avisos).toHaveLength(1)
    expect(segundo.avisos).toHaveLength(0)
  })
})

test.describe('Un envío fallido sí se reintenta', () => {
  test('el aviso vuelve a la cola', async () => {
    const { avisos } = await claimNotifications(db)
    const resultado = await reintentarAviso(db, avisos[0], 'evolution_502')

    expect(resultado.reintentara).toBe(true)
    expect(fila(1)?.processed_at).toBeNull()
    expect(fila(1)?.last_error).toBe('evolution_502')

    const segundo = await claimNotifications(db)
    expect(segundo.avisos, 'un fallo real tiene que poder reintentarse').toHaveLength(1)
  })

  test('con los intentos agotados deja de reintentarse', async () => {
    falso.tablas.notification_outbox = [aviso(1, { attempts: 4 })]
    const { avisos } = await claimNotifications(db)
    const resultado = await reintentarAviso(db, avisos[0], 'evolution_502')

    expect(resultado.reintentara).toBe(false)
    expect(fila(1)?.processed_at).toBeTruthy()
    expect((await claimNotifications(db)).avisos).toHaveLength(0)
  })
})

test.describe('El caso ambiguo queda a la vista', () => {
  test('mientras se entrega, la fila lleva una marca de "en vuelo"', async () => {
    await claimNotifications(db)
    expect(fila(1)?.last_error).toBe(MARCA_EN_VUELO)
  })

  test('si se entrega bien, la marca se limpia', async () => {
    const { avisos } = await claimNotifications(db)
    await marcarAvisoEnviado(db, avisos[0].id)
    expect(fila(1)?.last_error).toBeNull()
  })

  test('si falla, la marca se reemplaza por el motivo real', async () => {
    const { avisos } = await claimNotifications(db)
    await reintentarAviso(db, avisos[0], 'evolution_502')
    expect(fila(1)?.last_error).toBe('evolution_502')
  })

  test('una entrega que nunca cerró se puede contar, sin reenviarla sola', async () => {
    await claimNotifications(db)
    // Nadie escribió el resultado: no se sabe si el aviso salió.
    // El corte es "todo lo que quedó en vuelo hasta hace un instante".
    const ambiguos = await contarAvisosAmbiguos(db, new Date(Date.now() + 1000))

    expect(ambiguos, 'el fallo doble tiene que ser visible').toBe(1)
    expect((await claimNotifications(db)).avisos, 'pero no se reenvía sola: duplicaría').toHaveLength(0)
  })
})

test.describe('Lo que ya no corresponde se descarta', () => {
  test('un aviso descartado no vuelve', async () => {
    const { avisos } = await claimNotifications(db)
    await descartarAviso(db, avisos[0], 'cita_no_vigente')

    expect(fila(1)?.last_error).toBe('cita_no_vigente')
    expect((await claimNotifications(db)).avisos).toHaveLength(0)
  })
})
