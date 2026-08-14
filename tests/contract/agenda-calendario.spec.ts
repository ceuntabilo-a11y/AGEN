import { test, expect } from '@playwright/test'
import {
  ahoraEnElDia,
  descansos,
  horasDelEje,
  huecosLibres,
  posicion,
  restar,
  semanaDe,
  tramoDelDia,
  tramosDeTrabajo,
  unir,
  ventanaComun,
  ventanaDelDia,
  weekdayDeDateKey,
} from '@/lib/agenda-calendario'
import type { BusinessDay } from '@/lib/business-hours'

/**
 * Geometría de la agenda del profesional.
 *
 * "Mi agenda" era una lista de los próximos siete días: no se veía a qué hora caía cada cosa,
 * ni cuánto duraba, ni qué ratos quedaban libres. Ahora es un calendario, y toda la aritmética
 * —qué franja del día se dibuja, qué parte es jornada, dónde va cada cita— vive acá para poder
 * probarla sin navegador.
 *
 * El riesgo que más importa: que las horas se calculen en la zona del NAVEGADOR y no en la del
 * negocio. Un profesional mirando desde otro huso vería toda su agenda corrida, y eso no falla
 * de forma ruidosa: falla en silencio y con datos plausibles.
 */

const ZONA = 'America/Santiago'
const LUNES = '2026-08-10'

const horario = (weekday: number, startsAt: string, endsAt: string) => ({ weekday, startsAt, endsAt })

test.describe('Días de la semana sin depender del huso del navegador', () => {
  test('lunes es 1 y domingo es 7', () => {
    expect(weekdayDeDateKey('2026-08-10')).toBe(1)
    expect(weekdayDeDateKey('2026-08-16')).toBe(7)
  })

  test('la semana empieza en lunes y tiene siete días', () => {
    const semana = semanaDe('2026-08-13')
    expect(semana).toHaveLength(7)
    expect(semana[0]).toBe('2026-08-10')
    expect(semana[6]).toBe('2026-08-16')
  })

  test('un domingo pertenece a la semana que empieza el lunes anterior', () => {
    // El fallo clásico: tomar el domingo como primer día y mostrar la semana siguiente.
    expect(semanaDe('2026-08-16')[0]).toBe('2026-08-10')
  })
})

test.describe('Tramos: unir y restar', () => {
  test('los solapados se funden en uno', () => {
    expect(unir([{ desde: 540, hasta: 660 }, { desde: 600, hasta: 720 }])).toEqual([{ desde: 540, hasta: 720 }])
  })

  test('los que solo se tocan también', () => {
    expect(unir([{ desde: 540, hasta: 600 }, { desde: 600, hasta: 660 }])).toEqual([{ desde: 540, hasta: 660 }])
  })

  test('restar un rato del medio deja dos trozos', () => {
    expect(restar([{ desde: 540, hasta: 1080 }], [{ desde: 780, hasta: 840 }]))
      .toEqual([{ desde: 540, hasta: 780 }, { desde: 840, hasta: 1080 }])
  })

  test('restar algo que no toca no cambia nada', () => {
    expect(restar([{ desde: 540, hasta: 660 }], [{ desde: 900, hasta: 960 }])).toEqual([{ desde: 540, hasta: 660 }])
  })
})

test.describe('El negocio manda sobre el horario del profesional', () => {
  const cerradoElLunes: BusinessDay[] = [
    { day: 1, enabled: false, start: '09:00', end: '19:00' },
    ...[2, 3, 4, 5, 6, 7].map((day) => ({ day, enabled: true, start: '10:00', end: '18:00' })),
  ]

  test('sin horario de negocio configurado se respeta el del profesional', () => {
    // Los negocios que todavía no lo configuraron no pueden cambiar de conducta (§6.6).
    expect(tramosDeTrabajo(LUNES, [horario(1, '09:00', '18:00')], null)).toEqual([{ desde: 540, hasta: 1080 }])
  })

  test('un día que el negocio cierra no tiene jornada aunque el profesional diga que sí', () => {
    expect(tramosDeTrabajo(LUNES, [horario(1, '09:00', '18:00')], cerradoElLunes)).toEqual([])
  })

  test('la jornada se recorta a la ventana del negocio', () => {
    const martes = '2026-08-11'
    expect(tramosDeTrabajo(martes, [horario(2, '08:00', '20:00')], cerradoElLunes))
      .toEqual([{ desde: 600, hasta: 1080 }])
  })

  test('los tramos de otros días no se cuelan', () => {
    expect(tramosDeTrabajo(LUNES, [horario(2, '09:00', '18:00')], null)).toEqual([])
  })
})

test.describe('Descansos', () => {
  test('el hueco entre dos tramos del día es un descanso', () => {
    const trabajo = tramosDeTrabajo(LUNES, [horario(1, '09:00', '13:00'), horario(1, '15:00', '19:00')], null)
    expect(descansos(trabajo)).toEqual([{ desde: 780, hasta: 900 }])
  })

  test('una jornada continua no tiene descansos', () => {
    expect(descansos([{ desde: 540, hasta: 1080 }])).toEqual([])
  })
})

test.describe('Las horas se leen en la zona del negocio', () => {
  test('una cita de las 10:00 de Santiago aparece a las 10:00', () => {
    // 10:00 en Santiago (UTC-4 en agosto) son las 14:00 UTC.
    const tramo = tramoDelDia('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', LUNES, ZONA)
    expect(tramo).toEqual({ desde: 600, hasta: 660 })
  })

  test('una cita de otro día no aparece en este', () => {
    expect(tramoDelDia('2026-08-11T14:00:00Z', '2026-08-11T15:00:00Z', LUNES, ZONA)).toBeNull()
  })

  test('una cita que cruza la medianoche se recorta a cada día', () => {
    // 23:30 a 00:30 hora de Santiago.
    const inicio = '2026-08-11T03:30:00Z'
    const fin = '2026-08-11T04:30:00Z'
    expect(tramoDelDia(inicio, fin, LUNES, ZONA)).toEqual({ desde: 1410, hasta: 1440 })
    expect(tramoDelDia(inicio, fin, '2026-08-11', ZONA)).toEqual({ desde: 0, hasta: 30 })
  })

  test('la misma cita en otra zona cae a otra hora, y es lo correcto', () => {
    const santiago = tramoDelDia('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', LUNES, ZONA)
    const madrid = tramoDelDia('2026-08-10T14:00:00Z', '2026-08-10T15:00:00Z', LUNES, 'Europe/Madrid')
    expect(santiago).not.toEqual(madrid)
    expect(madrid).toEqual({ desde: 960, hasta: 1020 })
  })
})

test.describe('Franja dibujada', () => {
  test('se ajusta a la jornada, redondeada a horas', () => {
    expect(ventanaDelDia([{ desde: 545, hasta: 1075 }])).toEqual({ desde: 540, hasta: 1080 })
  })

  test('una cita fuera de la jornada no queda fuera del lienzo', () => {
    // Quien empieza a las 9:00 pero tiene algo a las 8:00 tiene que verlo.
    const ventana = ventanaDelDia([{ desde: 540, hasta: 1080 }], [{ desde: 480, hasta: 540 }])
    expect(ventana.desde).toBeLessThanOrEqual(480)
  })

  test('un día sin nada muestra una franja razonable en vez de estar vacío', () => {
    expect(ventanaDelDia([])).toEqual({ desde: 480, hasta: 1200 })
  })

  test('en vista semana todas las columnas comparten franja', () => {
    // Si cada día tuviera la suya, las 10:00 estarían a distinta altura en cada columna.
    const comun = ventanaComun([{ desde: 540, hasta: 1080 }, { desde: 480, hasta: 1200 }])
    expect(comun).toEqual({ desde: 480, hasta: 1200 })
  })

  test('el eje rotula una hora en punto por fila', () => {
    expect(horasDelEje({ desde: 540, hasta: 720 })).toEqual([540, 600, 660, 720])
  })
})

test.describe('Posición de una cita en el lienzo', () => {
  const ventana = { desde: 540, hasta: 1080 } // 09:00–18:00, 9 horas

  test('a media jornada cae a la mitad', () => {
    const { top } = posicion({ desde: 810, hasta: 840 }, ventana)
    expect(Math.round(top)).toBe(50)
  })

  test('la altura es proporcional a la duración', () => {
    const corta = posicion({ desde: 540, hasta: 600 }, ventana)
    const larga = posicion({ desde: 540, hasta: 720 }, ventana)
    expect(Math.round(larga.alto / corta.alto)).toBe(3)
  })

  test('una cita muy corta sigue siendo visible y pulsable', () => {
    expect(posicion({ desde: 600, hasta: 605 }, ventana).alto).toBeGreaterThanOrEqual(1.6)
  })

  test('nada se dibuja fuera del lienzo', () => {
    const { top, alto } = posicion({ desde: 0, hasta: 1440 }, ventana)
    expect(top).toBe(0)
    expect(top + alto).toBeLessThanOrEqual(100)
  })
})

test.describe('Huecos libres', () => {
  const jornada = [{ desde: 540, hasta: 1080 }]

  test('lo que queda tras citas y bloqueos', () => {
    const libres = huecosLibres(jornada, [{ desde: 600, hasta: 660 }, { desde: 780, hasta: 840 }])
    expect(libres).toEqual([
      { desde: 540, hasta: 600 },
      { desde: 660, hasta: 780 },
      { desde: 840, hasta: 1080 },
    ])
  })

  test('un hueco de cinco minutos entre dos citas no se ofrece', () => {
    // No es un espacio disponible: es ruido visual.
    const libres = huecosLibres(jornada, [{ desde: 540, hasta: 600 }, { desde: 605, hasta: 1080 }])
    expect(libres).toEqual([])
  })

  test('un día completamente ocupado no tiene huecos', () => {
    expect(huecosLibres(jornada, [{ desde: 540, hasta: 1080 }])).toEqual([])
  })

  test('un día sin jornada no ofrece huecos aunque no haya nada agendado', () => {
    expect(huecosLibres([], [])).toEqual([])
  })
})

test.describe('La línea de ahora', () => {
  test('solo aparece en el día de hoy, en la zona del negocio', () => {
    const ahora = new Date('2026-08-10T14:30:00Z') // 10:30 en Santiago
    expect(ahoraEnElDia(LUNES, ZONA, ahora)).toBe(630)
    expect(ahoraEnElDia('2026-08-11', ZONA, ahora)).toBeNull()
  })
})
