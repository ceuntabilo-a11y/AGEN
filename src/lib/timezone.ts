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

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}
