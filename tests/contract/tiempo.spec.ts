import { test, expect } from '@playwright/test'
import { referenciasTemporales } from '../../src/lib/timezone'
import { camposDelContexto, campoJson, contextoDelAgente, promptDelSistema } from '../support/n8n'
import { agrupar, catalogo, entrada, memoriaCliente, ZONA } from './fixtures'

/**
 * C2 — El agente no debe deducir fechas.
 *
 * Todas las referencias relativas ("hoy", "mañana", "esta semana", "el próximo lunes") las
 * calcula el backend en la zona del negocio y viajan resueltas en el contexto. Estas pruebas
 * fijan el instante de referencia, así que no dependen de cuándo se ejecuten.
 *
 * Semana: de lunes a domingo (misma convención que startOfWeekDateKey).
 * Fin de semana: el sábado y domingo de la semana en curso.
 * "Próximo <día>": la siguiente vez que ocurre ese día, siempre estrictamente futura.
 */

// Domingo 9 de agosto de 2026, 19:30 en Santiago (UTC−4 en agosto).
const DOMINGO = new Date('2026-08-09T23:30:00Z')
// Miércoles 12 de agosto de 2026, 11:00 en Santiago.
const MIERCOLES = new Date('2026-08-12T15:00:00Z')

const horas = (desde: string, hasta: string) => (new Date(hasta).getTime() - new Date(desde).getTime()) / 3600000

test.describe('C2 — referencias temporales del negocio', () => {
  test('1) "¿Qué citas tengo hoy?" — fecha local, día de semana y rango del día', () => {
    const tiempo = referenciasTemporales(DOMINGO, ZONA)
    expect(tiempo.zona).toBe(ZONA)
    expect(tiempo.hoy.fecha).toBe('2026-08-09')
    expect(tiempo.hoy.diaSemana).toBe('domingo')
    // El día local va de 00:00 a 00:00 del siguiente, expresado en instantes UTC.
    expect(tiempo.hoy.desde).toBe('2026-08-09T04:00:00.000Z')
    expect(tiempo.hoy.hasta).toBe('2026-08-10T04:00:00.000Z')
    expect(horas(tiempo.hoy.desde, tiempo.hoy.hasta)).toBe(24)
  })

  test('2) "¿Qué citas tengo mañana?"', () => {
    const tiempo = referenciasTemporales(DOMINGO, ZONA)
    expect(tiempo.manana.fecha).toBe('2026-08-10')
    expect(tiempo.manana.diaSemana).toBe('lunes')
    expect(tiempo.manana.desde).toBe('2026-08-10T04:00:00.000Z')
  })

  test('3) "¿Tengo citas pasado mañana?"', () => {
    const tiempo = referenciasTemporales(DOMINGO, ZONA)
    expect(tiempo.pasadoManana.fecha).toBe('2026-08-11')
    expect(tiempo.pasadoManana.diaSemana).toBe('martes')
  })

  test('4) "¿Qué tuve ayer?"', () => {
    const tiempo = referenciasTemporales(DOMINGO, ZONA)
    expect(tiempo.ayer.fecha).toBe('2026-08-08')
    expect(tiempo.ayer.diaSemana).toBe('sábado')
  })

  test('5) "¿Qué tengo esta semana?" — de lunes a domingo, incluido el domingo de hoy', () => {
    const tiempo = referenciasTemporales(DOMINGO, ZONA)
    expect(tiempo.estaSemana.fechaInicio).toBe('2026-08-03')
    expect(tiempo.estaSemana.fechaFin).toBe('2026-08-09')
    expect(tiempo.estaSemana.desde).toBe('2026-08-03T04:00:00.000Z')
    // El fin del rango es el inicio del lunes siguiente: 7 días completos.
    expect(tiempo.estaSemana.hasta).toBe('2026-08-10T04:00:00.000Z')
    expect(horas(tiempo.estaSemana.desde, tiempo.estaSemana.hasta)).toBe(24 * 7)
  })

  test('5b) a mitad de semana el lunes sigue siendo el mismo', () => {
    const tiempo = referenciasTemporales(MIERCOLES, ZONA)
    expect(tiempo.hoy.fecha).toBe('2026-08-12')
    expect(tiempo.hoy.diaSemana).toBe('miércoles')
    expect(tiempo.estaSemana.fechaInicio).toBe('2026-08-10')
    expect(tiempo.estaSemana.fechaFin).toBe('2026-08-16')
  })

  test('6) "¿Qué tengo la próxima semana?"', () => {
    const tiempo = referenciasTemporales(DOMINGO, ZONA)
    expect(tiempo.proximaSemana.fechaInicio).toBe('2026-08-10')
    expect(tiempo.proximaSemana.fechaFin).toBe('2026-08-16')
    expect(tiempo.proximaSemana.desde).toBe('2026-08-10T04:00:00.000Z')
    expect(horas(tiempo.proximaSemana.desde, tiempo.proximaSemana.hasta)).toBe(24 * 7)
  })

  test('7) "¿Qué tengo este fin de semana?" — sábado y domingo de la semana en curso', () => {
    const domingo = referenciasTemporales(DOMINGO, ZONA)
    expect(domingo.finDeSemana.fechaInicio).toBe('2026-08-08')
    expect(domingo.finDeSemana.fechaFin).toBe('2026-08-09')
    expect(horas(domingo.finDeSemana.desde, domingo.finDeSemana.hasta)).toBe(48)

    const miercoles = referenciasTemporales(MIERCOLES, ZONA)
    expect(miercoles.finDeSemana.fechaInicio).toBe('2026-08-15')
    expect(miercoles.finDeSemana.fechaFin).toBe('2026-08-16')
  })

  test('8) "¿Qué tengo el próximo lunes?" — siempre en el futuro', () => {
    const domingo = referenciasTemporales(DOMINGO, ZONA)
    expect(domingo.proximos.lunes).toBe('2026-08-10')
    expect(domingo.proximos.domingo).toBe('2026-08-16')
    expect(domingo.proximos.sabado).toBe('2026-08-15')

    // Un miércoles, "el próximo miércoles" es dentro de siete días, no hoy.
    const miercoles = referenciasTemporales(MIERCOLES, ZONA)
    expect(miercoles.proximos.miercoles).toBe('2026-08-19')
    expect(miercoles.proximos.lunes).toBe('2026-08-17')
    expect(miercoles.proximos.viernes).toBe('2026-08-14')
  })

  test('9) cruce UTC: a las 22:00 de Santiago el día UTC ya es el siguiente', () => {
    // 2026-08-10T02:00:00Z = domingo 9 de agosto, 22:00 en Santiago.
    const instante = new Date('2026-08-10T02:00:00Z')
    expect(instante.toISOString().slice(0, 10)).toBe('2026-08-10')

    const tiempo = referenciasTemporales(instante, ZONA)
    expect(tiempo.hoy.fecha).toBe('2026-08-09')
    expect(tiempo.hoy.diaSemana).toBe('domingo')
    expect(tiempo.manana.fecha).toBe('2026-08-10')
    expect(tiempo.ahoraLocal).toBe('2026-08-09 22:00')
    // Éste es el error que se elimina: usar el día UTC adelantaría todo un día.
    expect(tiempo.hoy.fecha).not.toBe(instante.toISOString().slice(0, 10))
  })

  test('10) DST de Chile: los días de cambio no duran 24 horas', () => {
    // 6 de septiembre de 2026: empieza el horario de verano, el día local dura 23 h.
    const inicioDst = referenciasTemporales(new Date('2026-09-06T15:00:00Z'), ZONA)
    expect(inicioDst.hoy.fecha).toBe('2026-09-06')
    expect(horas(inicioDst.hoy.desde, inicioDst.hoy.hasta)).toBe(23)

    // 4 de abril de 2026: termina, y el día local dura 25 h.
    const finDst = referenciasTemporales(new Date('2026-04-04T15:00:00Z'), ZONA)
    expect(finDst.hoy.fecha).toBe('2026-04-04')
    expect(horas(finDst.hoy.desde, finDst.hoy.hasta)).toBe(25)

    // La semana que contiene el cambio no dura 168 horas exactas.
    expect(horas(inicioDst.estaSemana.desde, inicioDst.estaSemana.hasta)).toBe(24 * 7 - 1)
  })

  test('11) sin offsets fijos: el mismo día del año cambia de offset según DST', () => {
    const enero = referenciasTemporales(new Date('2026-01-15T15:00:00Z'), ZONA)
    const agosto = referenciasTemporales(new Date('2026-08-15T15:00:00Z'), ZONA)
    // En enero Chile está en UTC−3 y en agosto en UTC−4: el inicio del día no coincide.
    expect(enero.hoy.desde).toBe('2026-01-15T03:00:00.000Z')
    expect(agosto.hoy.desde).toBe('2026-08-15T04:00:00.000Z')
  })

  test('12) otra zona horaria del negocio se respeta', () => {
    const madrid = referenciasTemporales(DOMINGO, 'Europe/Madrid')
    // 2026-08-09T23:30Z son las 01:30 del lunes 10 en Madrid (UTC+2 en verano).
    expect(madrid.zona).toBe('Europe/Madrid')
    expect(madrid.hoy.fecha).toBe('2026-08-10')
    expect(madrid.hoy.diaSemana).toBe('lunes')
  })

  test('13) una zona inválida cae en America/Santiago sin lanzar', () => {
    const tiempo = referenciasTemporales(DOMINGO, 'Marte/Olimpo')
    expect(tiempo.zona).toBe('America/Santiago')
    expect(tiempo.hoy.fecha).toBe('2026-08-09')
  })
})

test.describe('C2 — el contexto del agente entrega el tiempo resuelto', () => {
  const construir = (mensaje: string) =>
    contextoDelAgente({
      json: { ...memoriaCliente, ...catalogo, time: referenciasTemporales(DOMINGO, ZONA) },
      nodos: { Entrada: entrada(mensaje), Agrupar: agrupar(mensaje) },
    })

  test('el campo TIEMPO llega con hoy, mañana y los rangos', () => {
    const contexto = construir('¿Qué tengo mañana?')
    const campos = camposDelContexto(contexto)
    expect(campos.TIEMPO).toBeDefined()

    type Tiempo = ReturnType<typeof referenciasTemporales>
    const tiempo = campoJson<Tiempo>(contexto, 'TIEMPO')
    expect(tiempo.zona).toBe(ZONA)
    expect(tiempo.ahoraLocal).toBe('2026-08-09 19:30')
    expect(tiempo.hoy.fecha).toBe('2026-08-09')
    expect(tiempo.manana.fecha).toBe('2026-08-10')
    expect(tiempo.manana.diaSemana).toBe('lunes')
    expect(tiempo.estaSemana.fechaInicio).toBe('2026-08-03')
    expect(tiempo.proximaSemana.fechaFin).toBe('2026-08-16')
    expect(tiempo.finDeSemana.fechaInicio).toBe('2026-08-08')
    expect(tiempo.proximos.lunes).toBe('2026-08-10')
  })

  test('los rangos del contexto sirven tal cual para buscar_horarios', () => {
    type Tiempo = ReturnType<typeof referenciasTemporales>
    const tiempo = campoJson<Tiempo>(construir('¿Tienes hora mañana?'), 'TIEMPO')
    // La tool exige ISO 8601 y una ventana de 14 días como máximo.
    expect(tiempo.manana.desde).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(tiempo.manana.hasta).getTime()).toBeGreaterThan(new Date(tiempo.manana.desde).getTime())
    const dias = (new Date(tiempo.proximaSemana.hasta).getTime() - new Date(tiempo.estaSemana.desde).getTime()) / 86400000
    expect(dias).toBeLessThanOrEqual(14)
  })

  test('TIEMPO es ahora la única referencia temporal: AHORA desaparece del contexto', () => {
    const contexto = construir('¿Qué tengo hoy?')
    const campos = camposDelContexto(contexto)
    // Era redundante: su valor exacto vive en TIEMPO.ahoraUtc.
    expect(campos.AHORA).toBeUndefined()
    expect(contexto).not.toContain('AHORA:')
    expect(campos.ZONA).toBe(ZONA)
    expect(campos.TIEMPO).toContain('"fecha":"2026-08-09"')
  })

  test('TIEMPO conserva ahoraLocal y ahoraUtc', () => {
    type Tiempo = ReturnType<typeof referenciasTemporales>
    const tiempo = campoJson<Tiempo>(construir('¿Qué hora es?'), 'TIEMPO')
    expect(tiempo.ahoraLocal).toBe('2026-08-09 19:30')
    expect(tiempo.ahoraUtc).toBe('2026-08-09T23:30:00.000Z')
  })
})

/**
 * Entregar las fechas resueltas es media solución: el prompt tiene que decir que TIEMPO manda.
 * Sin esto el modelo puede seguir calculando por su cuenta aunque el dato correcto esté ahí.
 */
test.describe('C2 — el prompt declara TIEMPO como fuente autoritativa', () => {
  test('nombra TIEMPO y lo declara autoritativo para las fechas', () => {
    const prompt = promptDelSistema()
    expect(prompt).toContain('TIEMPO')
    expect(prompt).toMatch(/TIEMPO[^.]{0,120}(autoritativa|única fuente|fuente única)/i)
  })

  test('cubre todas las referencias relativas', () => {
    const prompt = promptDelSistema()
    for (const termino of ['hoy', 'mañana', 'ayer', 'pasado mañana', 'esta semana', 'próxima semana', 'fin de semana']) {
      expect(prompt.toLowerCase(), `el prompt no menciona "${termino}"`).toContain(termino)
    }
  })

  test('prohíbe deducir fechas por su cuenta o con offsets UTC', () => {
    const prompt = promptDelSistema()
    expect(prompt).toMatch(/nunca[^.]{0,160}(deduzcas|calcules)/i)
    expect(prompt).toContain('UTC')
  })
})
