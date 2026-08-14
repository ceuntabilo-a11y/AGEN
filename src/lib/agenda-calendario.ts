import type { BusinessDay } from '@/lib/business-hours'
import { addDaysToDateKey, dateKeyInZone, zonedDateTimeToUtc, zonedParts } from '@/lib/timezone'

/**
 * Geometría de una agenda de verdad: eje de horas, tramos de trabajo, descansos y dónde va
 * cada cita.
 *
 * Está aparte del componente a propósito. Toda la aritmética de una agenda —qué franja del día
 * se dibuja, qué parte es horario de trabajo, dónde empieza una cita que cruza el cambio de
 * hora— es lógica que se puede equivocar en silencio y que hay que poder probar sin navegador.
 * El componente solo pinta lo que estas funciones calculan.
 *
 * Todo se mide en **minutos desde la medianoche del día, en la zona del negocio**. Nunca en
 * hora local del navegador: un profesional mirando su agenda desde otro huso vería las citas
 * corridas (CLAUDE.md §1, "Zona horaria").
 */

/** Tramo de un día, en minutos desde medianoche. `[desde, hasta)`. */
export type Tramo = { desde: number; hasta: number }

export type Cita = {
  id: string
  /** ISO UTC. */
  inicio: string
  /** ISO UTC. */
  fin: string
}

export const MINUTOS_DIA = 24 * 60

/** Día de la semana 1..7 (1 = lunes), calculado sin depender del huso del navegador. */
export function weekdayDeDateKey(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  // `getUTCDay()` y no `getDay()`: la fecha se construye en UTC, así que leerla en hora local
  // corre el día entero al oeste de Greenwich. Es el mismo fallo que tuvo el mini-calendario.
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7
}

const aMinutos = (hhmm: string): number => {
  const [hora, minuto] = hhmm.split(':').map(Number)
  return (Number.isFinite(hora) ? hora : 0) * 60 + (Number.isFinite(minuto) ? minuto : 0)
}

export const aHoraTexto = (minutos: number): string => {
  const total = Math.max(0, Math.min(MINUTOS_DIA, Math.round(minutos)))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Intersección de dos tramos, o `null` si no se tocan. */
function cruce(a: Tramo, b: Tramo): Tramo | null {
  const desde = Math.max(a.desde, b.desde)
  const hasta = Math.min(a.hasta, b.hasta)
  return desde < hasta ? { desde, hasta } : null
}

/** Une tramos que se solapan o se tocan, y los deja ordenados. */
export function unir(tramos: Tramo[]): Tramo[] {
  const ordenados = [...tramos].filter((t) => t.hasta > t.desde).sort((a, b) => a.desde - b.desde)
  const salida: Tramo[] = []
  for (const tramo of ordenados) {
    const ultimo = salida[salida.length - 1]
    if (ultimo && tramo.desde <= ultimo.hasta) ultimo.hasta = Math.max(ultimo.hasta, tramo.hasta)
    else salida.push({ ...tramo })
  }
  return salida
}

/** Lo que queda de `base` al quitarle `huecos`. */
export function restar(base: Tramo[], huecos: Tramo[]): Tramo[] {
  let salida = unir(base)
  for (const hueco of unir(huecos)) {
    const siguiente: Tramo[] = []
    for (const tramo of salida) {
      if (hueco.hasta <= tramo.desde || hueco.desde >= tramo.hasta) { siguiente.push(tramo); continue }
      if (hueco.desde > tramo.desde) siguiente.push({ desde: tramo.desde, hasta: hueco.desde })
      if (hueco.hasta < tramo.hasta) siguiente.push({ desde: hueco.hasta, hasta: tramo.hasta })
    }
    salida = siguiente
  }
  return salida
}

export type TramoSemanal = { weekday: number; startsAt: string; endsAt: string }

/**
 * Cuándo trabaja esta persona ese día: su horario, recortado por el horario del negocio.
 *
 * El negocio manda sobre el profesional (CLAUDE.md §6.6): si el negocio cierra el domingo, da
 * igual lo que diga la ficha del profesional. `businessHours` en `null` significa "sin
 * configurar", que se interpreta como abierto — los negocios que aún no lo pusieron no
 * cambian de conducta.
 */
export function tramosDeTrabajo(
  dateKey: string,
  disponibilidad: TramoSemanal[],
  horarioNegocio: BusinessDay[] | null,
): Tramo[] {
  const weekday = weekdayDeDateKey(dateKey)
  const propios = unir(
    disponibilidad
      .filter((tramo) => tramo.weekday === weekday)
      .map((tramo) => ({ desde: aMinutos(tramo.startsAt), hasta: aMinutos(tramo.endsAt) })),
  )
  if (!horarioNegocio) return propios

  const dia = horarioNegocio.find((item) => item.day === weekday)
  if (!dia || !dia.enabled) return []
  const ventana = { desde: aMinutos(dia.start), hasta: aMinutos(dia.end) }
  return propios.map((tramo) => cruce(tramo, ventana)).filter((tramo): tramo is Tramo => tramo !== null)
}

/**
 * Descansos: los huecos ENTRE tramos de trabajo del mismo día.
 *
 * No es lo mismo que "no trabaja": la hora de almuerzo de quien atiende 09–13 y 15–19 es un
 * descanso dentro de su jornada, y se ve distinto de las horas en que sencillamente no está.
 */
export function descansos(tramos: Tramo[]): Tramo[] {
  const ordenados = unir(tramos)
  const salida: Tramo[] = []
  for (let i = 1; i < ordenados.length; i += 1) {
    salida.push({ desde: ordenados[i - 1].hasta, hasta: ordenados[i].desde })
  }
  return salida
}

/** Un rango UTC llevado a minutos del día indicado; `null` si no toca ese día. */
export function tramoDelDia(
  inicioUtc: string | Date,
  finUtc: string | Date,
  dateKey: string,
  timeZone: string,
): Tramo | null {
  const inicioDia = zonedDateTimeToUtc(dateKey, '00:00:00', timeZone).getTime()
  const finDia = zonedDateTimeToUtc(addDaysToDateKey(dateKey, 1), '00:00:00', timeZone).getTime()
  const inicio = new Date(inicioUtc).getTime()
  const fin = new Date(finUtc).getTime()
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null
  // Se recorta al día: una cita que cruza la medianoche se dibuja en los dos días, cada uno
  // con su trozo, en vez de desbordar el contenedor o desaparecer.
  const desde = Math.max(inicio, inicioDia)
  const hasta = Math.min(fin, finDia)
  if (hasta <= desde) return null
  return {
    desde: Math.round((desde - inicioDia) / 60000),
    hasta: Math.round((hasta - inicioDia) / 60000),
  }
}

/**
 * Franja del día que se dibuja.
 *
 * No es fija de 00:00 a 24:00 —serían 24 filas casi vacías— sino la jornada más lo que se
 * salga de ella: una cita a las 8:00 de quien empieza a las 9:00 tiene que verse, no quedar
 * fuera del lienzo. Se redondea a horas completas y se garantiza un mínimo de cuatro.
 */
export function ventanaDelDia(tramos: Tramo[], ocupado: Tramo[] = []): Tramo {
  const todos = [...tramos, ...ocupado].filter((t) => t.hasta > t.desde)
  if (!todos.length) return { desde: 8 * 60, hasta: 20 * 60 }
  const desde = Math.floor(Math.min(...todos.map((t) => t.desde)) / 60) * 60
  const hasta = Math.ceil(Math.max(...todos.map((t) => t.hasta)) / 60) * 60
  const ancho = Math.max(hasta - desde, 4 * 60)
  return { desde: Math.max(0, desde), hasta: Math.min(MINUTOS_DIA, desde + ancho) }
}

/** Franja común a varios días, para que en vista Semana todas las columnas cuadren. */
export function ventanaComun(ventanas: Tramo[]): Tramo {
  const utiles = ventanas.filter((v) => v.hasta > v.desde)
  if (!utiles.length) return { desde: 8 * 60, hasta: 20 * 60 }
  return {
    desde: Math.min(...utiles.map((v) => v.desde)),
    hasta: Math.max(...utiles.map((v) => v.hasta)),
  }
}

/** Posición vertical dentro de la franja, en porcentaje. Lo que usa el CSS. */
export function posicion(tramo: Tramo, ventana: Tramo): { top: number; alto: number } {
  const total = Math.max(1, ventana.hasta - ventana.desde)
  const desde = Math.max(tramo.desde, ventana.desde)
  const hasta = Math.min(tramo.hasta, ventana.hasta)
  const top = ((desde - ventana.desde) / total) * 100
  // Mínimo visible: una cita de 10 minutos en una jornada de 12 horas mide un 1,4 % y sin
  // suelo no se podría ni leer ni pulsar.
  const alto = Math.max(((hasta - desde) / total) * 100, 1.6)
  return { top: Math.max(0, top), alto: Math.min(alto, 100 - Math.max(0, top)) }
}

/** Las horas en punto que se rotulan en el eje. */
export function horasDelEje(ventana: Tramo): number[] {
  const horas: number[] = []
  for (let minuto = Math.ceil(ventana.desde / 60) * 60; minuto <= ventana.hasta; minuto += 60) horas.push(minuto)
  return horas
}

/**
 * Huecos libres de verdad: horario de trabajo menos citas, bloqueos y descansos.
 *
 * Se descartan los de menos de `minimoMinutos` porque un hueco de cinco minutos entre dos
 * citas no es un espacio disponible, es ruido visual.
 */
export function huecosLibres(tramos: Tramo[], ocupado: Tramo[], minimoMinutos = 15): Tramo[] {
  return restar(tramos, ocupado).filter((tramo) => tramo.hasta - tramo.desde >= minimoMinutos)
}

/** Los siete días de la semana a la que pertenece `dateKey` (lunes primero). */
export function semanaDe(dateKey: string): string[] {
  const weekday = weekdayDeDateKey(dateKey)
  const lunes = addDaysToDateKey(dateKey, 1 - weekday)
  return Array.from({ length: 7 }, (_, indice) => addDaysToDateKey(lunes, indice))
}

/** Minutos desde medianoche que marca "ahora", o `null` si `dateKey` no es hoy. */
export function ahoraEnElDia(dateKey: string, timeZone: string, ahora: Date = new Date()): number | null {
  if (dateKeyInZone(ahora, timeZone) !== dateKey) return null
  const { hour, minute } = zonedParts(ahora, timeZone)
  return hour * 60 + minute
}
