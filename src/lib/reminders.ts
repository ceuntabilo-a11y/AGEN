/**
 * Recordatorios que configura cada negocio.
 *
 * Vive en `businesses.settings.reminders` y lo lee la función SQL
 * `schedule_appointment_reminders`, que es quien programa la cola. Acá solo se normaliza y se
 * valida, para que el panel y la API usen exactamente las mismas reglas.
 *
 * Sin la clave, el negocio se queda con el valor sugerido (24 h y 2 h antes): los negocios que
 * no la configuren no cambian de conducta al desplegar.
 */

export type Reminder = { hoursBefore: number; enabled: boolean }

export const RECORDATORIOS_POR_DEFECTO: Reminder[] = [
  { hoursBefore: 24, enabled: true },
  { hoursBefore: 2, enabled: true },
]

/** Antelaciones que se ofrecen en el panel. Media hora es el mínimo útil; 14 días el máximo. */
export const ANTELACIONES = [0.5, 1, 2, 3, 4, 6, 12, 24, 48, 72, 168]

export const MAXIMO_RECORDATORIOS = 4

export function etiquetaDeAntelacion(horas: number) {
  if (horas < 1) return `${Math.round(horas * 60)} minutos antes`
  if (horas === 1) return '1 hora antes'
  if (horas < 24) return `${horas} horas antes`
  if (horas === 24) return '1 día antes'
  if (horas % 24 === 0) return `${horas / 24} días antes`
  return `${horas} horas antes`
}

/** Devuelve la lista válida, o `null` si el negocio no la tiene configurada. */
export function normalizeReminders(valor: unknown): Reminder[] | null {
  if (!Array.isArray(valor)) return null
  const limpios: Reminder[] = []
  for (const fila of valor) {
    if (!fila || typeof fila !== 'object') continue
    const horas = Number((fila as Record<string, unknown>).hoursBefore)
    if (!Number.isFinite(horas) || horas < 0.25 || horas > 336) continue
    if (limpios.some((item) => item.hoursBefore === horas)) continue
    limpios.push({ hoursBefore: horas, enabled: (fila as Record<string, unknown>).enabled !== false })
  }
  if (!limpios.length) return []
  return limpios.sort((a, b) => b.hoursBefore - a.hoursBefore).slice(0, MAXIMO_RECORDATORIOS)
}

/** Mensaje de error para la API, o `null` si la lista es aceptable. */
export function errorDeRecordatorios(valor: unknown): string | null {
  if (valor === undefined) return null
  if (!Array.isArray(valor)) return 'Los recordatorios deben ser una lista'
  if (valor.length > MAXIMO_RECORDATORIOS) return `Como máximo ${MAXIMO_RECORDATORIOS} recordatorios por cita`
  const vistos = new Set<number>()
  for (const fila of valor) {
    if (!fila || typeof fila !== 'object') return 'Recordatorio inválido'
    const horas = Number((fila as Record<string, unknown>).hoursBefore)
    if (!Number.isFinite(horas) || horas < 0.25 || horas > 336) {
      return 'Cada recordatorio debe estar entre 15 minutos y 14 días antes de la hora'
    }
    if (vistos.has(horas)) return 'Hay dos recordatorios con la misma antelación'
    vistos.add(horas)
  }
  return null
}
