import { test, expect } from '@playwright/test'
import { instanteDelNegocio } from '@/lib/timezone'

/**
 * Una hora sin zona es hora del NEGOCIO, no del servidor.
 *
 * El fallo, visto en una conversación real de producción: para "quiero hora el martes en la
 * tarde" el modelo pidió disponibilidad con `from: "2026-08-18T13:00:00"` — sin zona.
 * `new Date()` lo interpreta en la del proceso (UTC en el contenedor), así que la búsqueda se
 * hizo entre las **09:00 y las 15:00 hora de Santiago** y el agente le respondió al cliente
 * "no hay horas disponibles en la tarde del martes" cuando sí las había.
 *
 * Es el peor tipo de fallo: silencioso, sin error en ningún log, y con una respuesta
 * perfectamente plausible. Por eso la guarda va en la APP y no en el prompt: el prompt pide,
 * la app garantiza.
 */

const SANTIAGO = 'America/Santiago'

test.describe('Sin zona, se lee en la del negocio', () => {
  test('el caso exacto que falló: las 13:00 del martes son las 13:00 en Santiago', () => {
    // Agosto en Santiago es UTC-4, así que las 13:00 locales son las 17:00 UTC.
    const instante = instanteDelNegocio('2026-08-18T13:00:00', SANTIAGO)
    expect(instante?.toISOString()).toBe('2026-08-18T17:00:00.000Z')
  })

  test('una fecha sola es el comienzo del día del negocio', () => {
    expect(instanteDelNegocio('2026-08-18', SANTIAGO)?.toISOString()).toBe('2026-08-18T04:00:00.000Z')
  })

  test('acepta también el formato con espacio en vez de T', () => {
    expect(instanteDelNegocio('2026-08-18 13:00', SANTIAGO)?.toISOString()).toBe('2026-08-18T17:00:00.000Z')
  })

  test('respeta el horario de verano, sin offsets escritos a mano', () => {
    // En enero Santiago está en UTC-3: la misma hora local cae en otro instante.
    expect(instanteDelNegocio('2026-01-20T13:00:00', SANTIAGO)?.toISOString()).toBe('2026-01-20T16:00:00.000Z')
  })

  test('cada negocio en su zona', () => {
    const chile = instanteDelNegocio('2026-08-18T13:00:00', SANTIAGO)
    const madrid = instanteDelNegocio('2026-08-18T13:00:00', 'Europe/Madrid')
    expect(chile?.toISOString()).not.toBe(madrid?.toISOString())
    expect(madrid?.toISOString()).toBe('2026-08-18T11:00:00.000Z')
  })
})

test.describe('Con zona, se respeta tal cual', () => {
  test('una hora con Z es un instante y no se reinterpreta', () => {
    expect(instanteDelNegocio('2026-08-18T13:00:00Z', SANTIAGO)?.toISOString()).toBe('2026-08-18T13:00:00.000Z')
  })

  test('lo que devuelve buscar_horarios entra sin cambios', () => {
    // El modelo normalmente reenvía el `service_start` que le dio la app, que ya trae offset.
    const deLaApp = '2026-08-17T13:00:00+00:00'
    expect(instanteDelNegocio(deLaApp, SANTIAGO)?.toISOString()).toBe('2026-08-17T13:00:00.000Z')
  })

  test('un offset distinto de cero también se respeta', () => {
    expect(instanteDelNegocio('2026-08-18T13:00:00-04:00', SANTIAGO)?.toISOString()).toBe('2026-08-18T17:00:00.000Z')
  })
})

test.describe('Basura', () => {
  test('lo que no es una fecha devuelve null, no una fecha inventada', () => {
    for (const valor of ['', '   ', 'mañana', null, undefined, 42, {}]) {
      expect(instanteDelNegocio(valor, SANTIAGO)).toBeNull()
    }
  })

  test('una zona inválida no rompe: se usa la de por defecto', () => {
    expect(instanteDelNegocio('2026-08-18T13:00:00', 'Marte/Olympus')?.toISOString()).toBe('2026-08-18T17:00:00.000Z')
  })
})
