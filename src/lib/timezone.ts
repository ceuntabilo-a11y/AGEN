export type ZonedDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormatter = (timeZone: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function zonedParts(value: Date | string, timeZone: string): ZonedDateParts {
  const date = value instanceof Date ? value : new Date(value)
  const values: Record<string, string> = {}
  for (const part of partsFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) === 24 ? 0 : Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

export function dateKeyInZone(value: Date | string, timeZone: string) {
  const { year, month, day } = zonedParts(value, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function startOfWeekDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7
  return addDaysToDateKey(dateKey, 1 - weekday)
}

export function startOfMonthDateKey(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`
}

export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute, second = 0] = time.split(':').map(Number)
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = targetAsUtc

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(guess), timeZone)
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const difference = targetAsUtc - representedAsUtc
    guess += difference
    if (difference === 0) break
  }

  return new Date(guess)
}

export function zonedDayRange(dateKey: string, timeZone: string) {
  return {
    from: zonedDateTimeToUtc(dateKey, '00:00:00', timeZone).toISOString(),
    until: zonedDateTimeToUtc(addDaysToDateKey(dateKey, 1), '00:00:00', timeZone).toISOString(),
  }
}

export function formatInZone(
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'es-CL',
) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date)
}

export function formatTimeInZone(value: Date | string, timeZone: string) {
  return formatInZone(value, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false })
}

export const DEFAULT_TIME_ZONE = 'America/Santiago'

/** Nombres en español de los días, indexados como `Date.getUTCDay()` (0 = domingo). */
const NOMBRES_DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const
/** Claves sin tilde para poder usarlas como propiedades desde el agente. */
const CLAVES_DIA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'] as const

export type DiaReferencia = {
  /** Fecha local del negocio, `YYYY-MM-DD`. */
  fecha: string
  diaSemana: string
  /** Instante UTC del inicio del día local. */
  desde: string
  /** Instante UTC del inicio del día siguiente. */
  hasta: string
}

export type RangoReferencia = {
  fechaInicio: string
  fechaFin: string
  diaInicio: string
  diaFin: string
  desde: string
  hasta: string
}

export type ReferenciasTemporales = {
  zona: string
  /** `YYYY-MM-DD HH:MM` en la zona del negocio. */
  ahoraLocal: string
  ahoraUtc: string
  hoy: DiaReferencia
  manana: DiaReferencia
  pasadoManana: DiaReferencia
  ayer: DiaReferencia
  estaSemana: RangoReferencia
  proximaSemana: RangoReferencia
  finDeSemana: RangoReferencia
  /** Próxima vez que ocurre cada día, siempre estrictamente futura. */
  proximos: Record<(typeof CLAVES_DIA)[number], string>
}

/** Día de la semana de una fecha `YYYY-MM-DD`, con 0 = domingo. */
function indiceDia(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function dia(dateKey: string, timeZone: string): DiaReferencia {
  const { from, until } = zonedDayRange(dateKey, timeZone)
  return { fecha: dateKey, diaSemana: NOMBRES_DIA[indiceDia(dateKey)], desde: from, hasta: until }
}

function rango(inicio: string, fin: string, timeZone: string): RangoReferencia {
  return {
    fechaInicio: inicio,
    fechaFin: fin,
    diaInicio: NOMBRES_DIA[indiceDia(inicio)],
    diaFin: NOMBRES_DIA[indiceDia(fin)],
    desde: zonedDayRange(inicio, timeZone).from,
    // El rango termina cuando empieza el día siguiente al último: así `fin` queda incluido.
    hasta: zonedDayRange(fin, timeZone).until,
  }
}

/**
 * Todas las fechas relativas que el agente podría necesitar, resueltas en la zona del negocio.
 *
 * Existe para que el modelo no tenga que deducir qué día es "mañana" a partir de un instante
 * UTC: al oeste de Greenwich el día UTC se adelanta por la tarde y la deducción falla. Aquí
 * todo sale de `zonedDayRange`, que usa Intl y por tanto respeta el horario de verano; no hay
 * ningún offset fijo escrito a mano.
 *
 * Convenciones: la semana va de lunes a domingo y el fin de semana es el sábado y domingo de
 * la semana en curso. "Próximo <día>" es siempre una fecha futura: si hoy es miércoles, el
 * próximo miércoles cae dentro de siete días.
 */
export function referenciasTemporales(ahora: Date, timeZone: unknown): ReferenciasTemporales {
  const zona = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE
  const hoy = dateKeyInZone(ahora, zona)
  const { hour, minute } = zonedParts(ahora, zona)

  const inicioSemana = startOfWeekDateKey(hoy)
  const finSemana = addDaysToDateKey(inicioSemana, 6)
  const inicioProxima = addDaysToDateKey(inicioSemana, 7)

  const proximos = {} as Record<(typeof CLAVES_DIA)[number], string>
  for (let indice = 0; indice < 7; indice += 1) {
    const clave = CLAVES_DIA[indice]
    // 1..7 días hacia adelante: nunca hoy.
    const saltos = ((indice - indiceDia(hoy) + 7) % 7) || 7
    proximos[clave] = addDaysToDateKey(hoy, saltos)
  }

  return {
    zona,
    ahoraLocal: `${hoy} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    ahoraUtc: ahora.toISOString(),
    hoy: dia(hoy, zona),
    manana: dia(addDaysToDateKey(hoy, 1), zona),
    pasadoManana: dia(addDaysToDateKey(hoy, 2), zona),
    ayer: dia(addDaysToDateKey(hoy, -1), zona),
    estaSemana: rango(inicioSemana, finSemana, zona),
    proximaSemana: rango(inicioProxima, addDaysToDateKey(inicioProxima, 6), zona),
    finDeSemana: rango(addDaysToDateKey(inicioSemana, 5), finSemana, zona),
    proximos,
  }
}

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

/**
 * Un instante mandado por el agente, interpretado en la zona del NEGOCIO cuando no trae zona.
 *
 * El fallo que cierra, visto en producción: el modelo pidió horarios con
 * `from: "2026-08-18T13:00:00"` —sin zona— para buscar "el martes en la tarde". `new Date()`
 * interpreta eso en la zona del proceso (UTC en el contenedor), así que la búsqueda se hizo
 * entre las 09:00 y las 15:00 hora de Santiago y el agente le contestó al cliente "no hay
 * horas en la tarde del martes" cuando sí las había. Un fallo silencioso y con una respuesta
 * perfectamente plausible: el peor tipo.
 *
 * La regla es la del sentido común de quien escribe: si la cadena trae zona (`Z` o `±HH:MM`)
 * es un instante y no admite interpretación, se respeta tal cual. Si no la trae, es hora local
 * del negocio.
 */
export function instanteDelNegocio(valor: unknown, timeZone: string): Date | null {
  if (typeof valor !== 'string' || !valor.trim()) return null
  const texto = valor.trim()

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto)) {
    const conZona = new Date(texto)
    return Number.isNaN(conZona.getTime()) ? null : conZona
  }

  const partes = texto.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/)
  if (!partes) {
    // Formato que no reconocemos: se deja como estaba antes en vez de inventar una lectura.
    const suelto = new Date(texto)
    return Number.isNaN(suelto.getTime()) ? null : suelto
  }

  const [, dateKey, hora] = partes
  const zona = validTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE
  const fecha = zonedDateTimeToUtc(dateKey, `${hora ?? '00:00'}:00`.slice(0, 8), zona)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}
