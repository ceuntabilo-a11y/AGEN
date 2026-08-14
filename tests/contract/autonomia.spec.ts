import { test, expect } from '@playwright/test'
import { ACCIONES, decidirAutonomia, esAccionQueEscribe } from '../../scripts/autonomia-logica.mjs'

/**
 * El ciclo autónomo decide sin supervisión y puede abrir un PR sobre el repositorio, así que
 * su criterio va probado caso por caso. Lo que se fija es el orden de prioridades y, sobre
 * todo, **cuándo NO actúa**: una automatización que actúa de más es peor que una que avisa.
 */

const sano = {
  produccionSana: true,
  ciDeMain: 'success',
  ultimoVerde: 'aaaaaaa',
  headDeMain: 'aaaaaaa',
  alertaAbierta: false,
}

test.describe('Con todo sano no toca nada', () => {
  test('ni PR, ni alerta, ni ruido', () => {
    expect(decidirAutonomia(sano).accion).toBe(ACCIONES.NADA)
    expect(esAccionQueEscribe(ACCIONES.NADA)).toBe(false)
  })

  test('si quedaba una alerta del corte anterior, se cierra sola', () => {
    expect(decidirAutonomia({ ...sano, alertaAbierta: true }).accion).toBe(ACCIONES.CERRAR_ALERTA)
  })

  test('sin AGEN_APP_URL no inventa que producción esté caída', () => {
    expect(decidirAutonomia({ ...sano, produccionSana: null }).accion).toBe(ACCIONES.NADA)
  })
})

test.describe('main en rojo: propone volver al último verde', () => {
  const roto = { ...sano, ciDeMain: 'failure', headDeMain: 'ffffff1', ultimoVerde: 'bbbbbb2' }

  test('la acción es ROLLBACK y dice hasta dónde', () => {
    const decision = decidirAutonomia(roto)
    expect(decision.accion).toBe(ACCIONES.ROLLBACK)
    expect(decision.hasta).toBe('bbbbbb2')
  })

  test('si no hay ningún commit verde anterior, no inventa una reversión', () => {
    expect(decidirAutonomia({ ...roto, ultimoVerde: null }).accion).toBe(ACCIONES.ALERTAR_SIN_VERDE)
  })

  test('si el último verde ES el head, no se revierte a sí mismo', () => {
    expect(decidirAutonomia({ ...roto, ultimoVerde: roto.headDeMain }).accion).toBe(ACCIONES.ALERTAR_SIN_VERDE)
  })

  test('con un PR de reversión ya abierto no abre otro', () => {
    expect(decidirAutonomia({ ...roto, reversionYaAbierta: true }).accion).toBe(ACCIONES.NADA)
  })

  test('si la reversión tampoco pasa la validación, avisa en vez de proponerla', () => {
    const decision = decidirAutonomia({ ...roto, validacionOk: false })
    expect(decision.accion).toBe(ACCIONES.ALERTAR_ROLLBACK_INVALIDO)
    expect(decision.motivo).toContain('revertir no arregla')
  })

  test('una regresión de código manda sobre la salud de producción', () => {
    // Si main está roto, revertir es lo primero: producción caída puede ser consecuencia.
    expect(decidirAutonomia({ ...roto, produccionSana: false }).accion).toBe(ACCIONES.ROLLBACK)
  })
})

test.describe('Producción caída con el código verde no se arregla revirtiendo', () => {
  test('avisa, y dice por qué no revierte', () => {
    const decision = decidirAutonomia({ ...sano, produccionSana: false })
    expect(decision.accion).toBe(ACCIONES.ALERTAR_PRODUCCION)
    expect(decision.motivo).toContain('no es una regresión')
  })

  test('no propone ninguna reversión aunque haya un commit verde disponible', () => {
    const decision = decidirAutonomia({ ...sano, produccionSana: false, ultimoVerde: 'bbbbbb2', headDeMain: 'ccccc33' })
    expect(decision.accion).not.toBe(ACCIONES.ROLLBACK)
  })
})

test.describe('Sin ejecución de CI todavía, no se decide nada a ciegas', () => {
  test('un commit recién empujado no dispara una reversión', () => {
    expect(decidirAutonomia({ ...sano, ciDeMain: null }).accion).toBe(ACCIONES.NADA)
  })

  test('un CI cancelado tampoco cuenta como rojo', () => {
    expect(decidirAutonomia({ ...sano, ciDeMain: 'cancelled' }).accion).toBe(ACCIONES.NADA)
  })
})
