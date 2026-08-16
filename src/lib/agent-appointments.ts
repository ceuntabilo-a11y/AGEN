import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Reservas del propio cliente que le escribe al agente.
 *
 * Vive fuera de la ruta porque acá está la garantía que importa: una mutación identifica
 * SIEMPRE la reserva por su id, y repetirla no produce una segunda mutación. Antes, cuando
 * el modelo no mandaba `appointmentId`, la ruta actuaba sobre "la más próxima": un reintento
 * después de una cancelación exitosa cancelaba la SIGUIENTE reserva del cliente.
 */

export type ReservaDelCliente = {
  id: string
  status: string
  service_period: string
  client_confirmed_at: string | null
  professional?: { display_name?: string | null } | null
  service?: { name?: string | null } | null
}

export const CAMPOS_RESERVA =
  'id,status,service_period,client_confirmed_at,professional:professionals(display_name),service:services(name)'

/** Estados sobre los que el cliente todavía puede actuar. */
const VIGENTES = ['PENDING', 'CONFIRMED']

/** `confirm` y `release` mutan: necesitan saber exactamente sobre qué reserva actúan. */
export function requiereIdDeReserva(accion: string) {
  return accion === 'confirm' || accion === 'release' || accion === 'reschedule'
}

/** Próximas reservas vigentes del cliente (lo que devuelve `mis_reservas`). */
export async function listClientAppointments(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string; diasHaciaAdelante?: number },
) {
  const dias = datos.diasHaciaAdelante ?? 90
  return db.from('appointments')
    .select(CAMPOS_RESERVA)
    .eq('business_id', datos.businessId).eq('client_id', datos.clientId)
    .in('status', VIGENTES)
    .overlaps('service_period', `[${new Date().toISOString()},${new Date(Date.now() + dias * 86400000).toISOString()})`)
    .order('service_period').limit(5)
}

/**
 * La reserva exacta sobre la que se va a actuar, siempre acotada al negocio y al cliente que
 * escribe. Devuelve también las canceladas: un reintento tiene que poder reconocer que su
 * propia cancelación ya se aplicó, en vez de recibir un 404 y volver a intentarlo.
 */
export async function findClientAppointment(
  db: SupabaseClient,
  datos: { businessId: string; clientId: string; appointmentId: string },
) {
  const { data, error } = await db.from('appointments')
    .select(CAMPOS_RESERVA)
    .eq('business_id', datos.businessId).eq('client_id', datos.clientId).eq('id', datos.appointmentId)
    .maybeSingle()
  return { reserva: (data as ReservaDelCliente | null) ?? null, error }
}

export type ResultadoMutacion =
  | { ok: true; yaEstaba: boolean }
  | { ok: false; motivo: 'no_vigente' | 'fallo' }

/** Idempotente: si el cliente ya confirmó, no se vuelve a llamar a la función SQL. */
export async function confirmClientAppointment(db: SupabaseClient, reserva: ReservaDelCliente): Promise<ResultadoMutacion> {
  if (reserva.client_confirmed_at) return { ok: true, yaEstaba: true }
  if (!VIGENTES.includes(reserva.status)) return { ok: false, motivo: 'no_vigente' }

  const { error } = await db.rpc('confirm_appointment_by_client', { p_appointment_id: reserva.id })
  if (error) return { ok: false, motivo: 'fallo' }
  return { ok: true, yaEstaba: false }
}

/** Idempotente: si la reserva ya está cancelada, no se vuelve a cancelar. */
export async function releaseClientAppointment(
  db: SupabaseClient,
  reserva: ReservaDelCliente,
  motivo: string,
): Promise<ResultadoMutacion> {
  if (reserva.status === 'CANCELLED') return { ok: true, yaEstaba: true }
  if (!VIGENTES.includes(reserva.status)) return { ok: false, motivo: 'no_vigente' }

  const { error } = await db.rpc('cancel_safe_appointment', {
    p_appointment_id: reserva.id,
    p_reason: motivo,
    p_actor: 'Tú lo pediste por WhatsApp',
  })
  if (error) return { ok: false, motivo: 'fallo' }
  return { ok: true, yaEstaba: false }
}
