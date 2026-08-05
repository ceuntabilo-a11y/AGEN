import type { SupabaseClient } from '@supabase/supabase-js'

export type AvailabilitySlot = { weekday: number; startsAt: string; endsAt: string }

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/
const MAX_SLOTS = 28

/** Horario por defecto de un profesional nuevo: lunes a viernes, 09:00 a 18:00. */
export const DEFAULT_AVAILABILITY: AvailabilitySlot[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt: '09:00', endsAt: '18:00' }))

/** Valida el horario recibido del navegador. Devuelve el error en español o los tramos limpios. */
export function parseAvailability(input: unknown): { error: string } | { slots: AvailabilitySlot[] } {
  if (!Array.isArray(input)) return { error: 'Formato de horario inválido' }
  if (input.length > MAX_SLOTS) return { error: `Máximo ${MAX_SLOTS} tramos de horario` }
  const slots: AvailabilitySlot[] = []
  for (const raw of input) {
    const slot = raw as { weekday?: unknown; startsAt?: unknown; endsAt?: unknown }
    const weekday = Number(slot.weekday)
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: 'Día de la semana inválido' }
    const startsAt = String(slot.startsAt ?? '').slice(0, 8)
    const endsAt = String(slot.endsAt ?? '').slice(0, 8)
    if (!TIME.test(startsAt) || !TIME.test(endsAt)) return { error: 'Las horas deben tener formato HH:MM' }
    if (startsAt >= endsAt) return { error: 'La hora de inicio debe ser anterior a la de término' }
    slots.push({ weekday, startsAt, endsAt })
  }
  const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt))
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]
    const current = sorted[i]
    if (current.weekday === previous.weekday && current.startsAt < previous.endsAt) return { error: 'Hay tramos que se cruzan en el mismo día' }
  }
  return { slots: sorted }
}

/** Reemplaza el horario completo del profesional. El llamador ya validó que pertenece al negocio. */
export async function replaceAvailability(db: SupabaseClient, professionalId: string, slots: AvailabilitySlot[]) {
  const { error: deleteError } = await db.from('professional_availability').delete().eq('professional_id', professionalId)
  if (deleteError) throw deleteError
  if (!slots.length) return
  const { error: insertError } = await db.from('professional_availability').insert(slots.map((slot) => ({
    professional_id: professionalId,
    weekday: slot.weekday,
    starts_at: slot.startsAt.length === 5 ? `${slot.startsAt}:00` : slot.startsAt,
    ends_at: slot.endsAt.length === 5 ? `${slot.endsAt}:00` : slot.endsAt,
    active: true,
  })))
  if (insertError) throw insertError
}

export async function readAvailability(db: SupabaseClient, professionalId: string) {
  const { data, error } = await db.from('professional_availability').select('weekday,starts_at,ends_at,active').eq('professional_id', professionalId).eq('active', true).order('weekday').limit(MAX_SLOTS)
  if (error) throw error
  return (data ?? []).map((row) => ({ weekday: row.weekday as number, startsAt: String(row.starts_at).slice(0, 5), endsAt: String(row.ends_at).slice(0, 5) }))
}
