import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Horario de atención del negocio: qué días abre y entre qué horas.
 *
 * Vive en `businesses.settings.business_hours` y manda sobre el horario de cada profesional.
 * En la base lo aplica `business_day_window()` dentro de `find_available_professionals`; aquí
 * está la misma regla para poder avisar en pantalla antes de intentar guardar.
 */

export type BusinessDay = { day: number; enabled: boolean; start: string; end: string }

export const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo',
}

/** Para frases del tipo "el negocio cierra los domingos". */
export const WEEKDAY_PLURAL: Record<number, string> = {
  1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábados', 7: 'domingos',
}

export const DEFAULT_BUSINESS_HOURS: BusinessDay[] = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day,
  enabled: day <= 6,
  start: '09:00',
  end: day === 6 ? '14:00' : '19:00',
}))

/** Normaliza lo guardado a los 7 días. Sin nada guardado devuelve `null` = abierto siempre. */
export function normalizeBusinessHours(value: unknown): BusinessDay[] | null {
  const stored = Array.isArray(value) ? value as Array<Record<string, unknown>> : []
  if (!stored.length) return null
  return [1, 2, 3, 4, 5, 6, 7].map((day) => {
    const found = stored.find((item) => Number(item.day) === day)
    if (!found) return { day, enabled: false, start: '09:00', end: '19:00' }
    return {
      day,
      enabled: found.enabled !== false,
      start: typeof found.start === 'string' && found.start ? found.start.slice(0, 5) : '09:00',
      end: typeof found.end === 'string' && found.end ? found.end.slice(0, 5) : '19:00',
    }
  })
}

export async function loadBusinessHours(db: SupabaseClient, businessId: string) {
  const { data } = await db.from('businesses').select('settings').eq('id', businessId).maybeSingle()
  return normalizeBusinessHours((data?.settings as Record<string, unknown> | undefined)?.business_hours)
}

/**
 * Un profesional solo puede atender los días y horas que el negocio tiene abiertos.
 * Devuelve el error en español, o `null` si el horario cabe dentro del del negocio.
 */
export function validateAgainstBusinessHours(
  slots: Array<{ weekday: number; startsAt: string; endsAt: string }>,
  hours: BusinessDay[] | null,
) {
  if (!hours) return null
  for (const slot of slots) {
    const day = hours.find((item) => item.day === slot.weekday)
    const name = WEEKDAY_PLURAL[slot.weekday] ?? 'ese día'
    if (!day || !day.enabled) return `El negocio cierra los ${name}: quita ese tramo o abre el día en Configuración → Horario de atención.`
    const start = slot.startsAt.slice(0, 5)
    const end = slot.endsAt.slice(0, 5)
    if (start < day.start || end > day.end) {
      return `Los ${name} el negocio atiende de ${day.start} a ${day.end}: el tramo ${start}–${end} se sale de ese horario.`
    }
  }
  return null
}
