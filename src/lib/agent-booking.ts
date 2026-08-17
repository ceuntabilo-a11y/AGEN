import type { SupabaseClient } from '@supabase/supabase-js'
import { motivoDeError } from '@/lib/agent-errors'
import { claveDeContacto } from '@/lib/agent-holds'
import { registrarAviso } from '@/lib/observabilidad'
import { instanteDelNegocio } from '@/lib/timezone'

/**
 * La reserva y el alta de cliente, fuera de sus rutas HTTP.
 *
 * Se extrajeron tal cual estaban en `/api/agent/book` y `/api/agent/clients` porque ahora hay
 * DOS caminos que necesitan exactamente el mismo comportamiento: la herramienta antigua del
 * agente (que se conserva para no romper nada) y el ejecutor fijo `/api/agent/act`, que es
 * quien reserva desde el router. Duplicar esta lógica sería garantizar que un día se
 * comporten distinto.
 *
 * No cambia ninguna regla: sigue exigiendo apartado, sigue renovándolo si venció y sigue
 * reservando por `confirm_held_appointment`.
 */

export type ResultadoReserva =
  | { ok: true; appointment: Record<string, unknown> }
  | { ok: false; estado: number; error: string; motivo: string; conflict?: boolean }

export async function reservarConApartado(
  db: SupabaseClient,
  datos: {
    businessId: string
    clientId: string
    professionalId: string
    serviceId: string
    desiredStart: string
    holdId: string
    branchId?: string | null
    notes?: string | null
    contactKey?: string | null
    timezone?: string | null
  },
): Promise<ResultadoReserva> {
  const zona = datos.timezone
    ?? (await db.from('businesses').select('timezone').eq('id', datos.businessId).maybeSingle()).data?.timezone
    ?? 'America/Santiago'

  const desiredStart = instanteDelNegocio(datos.desiredStart, zona)
  if (!desiredStart || desiredStart.getTime() <= Date.now()) {
    return { ok: false, estado: 400, error: 'desiredStart debe ser una fecha ISO futura válida', motivo: 'DATO_INVALIDO' }
  }

  const branchId = !datos.branchId || datos.branchId === 'null' ? null : datos.branchId
  let holdId = datos.holdId

  const { data: hold, error: holdError } = await db.from('appointment_holds')
    .select('id,business_id,professional_id,service_id,period,expires_at')
    .eq('id', holdId).eq('business_id', datos.businessId)
    .eq('professional_id', datos.professionalId).eq('service_id', datos.serviceId).maybeSingle()
  if (holdError) return { ok: false, estado: 500, error: 'No se pudo validar el apartado', motivo: 'ERROR_TECNICO' }

  if (!hold || new Date(hold.expires_at).getTime() <= Date.now()) {
    const renovado = await db.rpc('create_slot_hold', {
      p_business_id: datos.businessId, p_professional_id: datos.professionalId, p_service_id: datos.serviceId,
      p_desired_start: desiredStart.toISOString(), p_client_id: datos.clientId,
      p_contact_key: claveDeContacto(datos.contactKey), p_minutes: 15, p_origin: 'AI_AGENT',
    })
    if (renovado.error || !renovado.data) {
      registrarAviso('agente_reserva_apartado_perdido', { businessId: datos.businessId, motivo: hold ? 'vencido' : 'inexistente' })
      return { ok: false, estado: 409, error: 'Ese horario acaba de ocuparse', motivo: 'CUPO_OCUPADO', conflict: true }
    }
    registrarAviso('agente_reserva_apartado_renovado', { businessId: datos.businessId })
    holdId = renovado.data.id
  } else {
    const { data: service } = await db.from('services').select('buffer_before_minutes')
      .eq('id', datos.serviceId).eq('business_id', datos.businessId).maybeSingle()
    const occupiedStart = String(hold.period).replace(/[[\]()"]/g, '').split(',')[0]
    const heldStart = new Date(new Date(occupiedStart).getTime() + Number(service?.buffer_before_minutes ?? 0) * 60000)
    if (Math.abs(heldStart.getTime() - desiredStart.getTime()) > 1000) {
      return { ok: false, estado: 409, error: 'El horario no corresponde al apartado', motivo: 'CUPO_OCUPADO', conflict: true }
    }
  }

  const { data, error } = await db.rpc('confirm_held_appointment', {
    p_hold_id: holdId, p_client_id: datos.clientId, p_branch_id: branchId, p_notes: datos.notes?.slice(0, 1000) ?? null,
  })
  if (error?.code === '23P01') {
    return { ok: false, estado: 409, error: error.message, motivo: motivoDeError(error), conflict: true }
  }
  if (error) return { ok: false, estado: 500, error: 'No se pudo crear la reserva', motivo: motivoDeError(error) }

  return { ok: true, appointment: (data ?? {}) as Record<string, unknown> }
}

export type ResultadoCliente =
  | { ok: true; created: boolean; client: Record<string, unknown> }
  | { ok: false; estado: number; error: string; motivo: string; needsName?: boolean }

/**
 * Alta o actualización del cliente que escribe.
 *
 * Amplía lo que ya hacía `/api/agent/clients` con la fecha de nacimiento, que el pipeline de
 * marketing necesita (`resolveCampaignAudience` segmenta por ella) y que hasta ahora solo se
 * podía escribir desde el panel.
 */
export async function guardarClienteDelAgente(
  db: SupabaseClient,
  datos: {
    businessId: string
    phone: string
    fullName?: string | null
    email?: string | null
    birthday?: string | null
    marketingOptIn?: boolean
  },
): Promise<ResultadoCliente> {
  const { data: existing, error: lookupError } = await db.from('clients')
    .select('id,full_name,phone,email,birthday,marketing_opt_in')
    .eq('business_id', datos.businessId).eq('phone', datos.phone).maybeSingle()
  if (lookupError) return { ok: false, estado: 500, error: 'No se pudo consultar el cliente', motivo: 'ERROR_TECNICO' }

  const nombre = datos.fullName?.trim()
  const correo = datos.email?.trim().toLowerCase()
  const nacimiento = datos.birthday?.trim()

  if (existing) {
    const changes: Record<string, unknown> = {}
    if (nombre && nombre !== existing.full_name) changes.full_name = nombre.slice(0, 200)
    if (correo && correo !== existing.email) changes.email = correo
    if (nacimiento && nacimiento !== existing.birthday) changes.birthday = nacimiento
    if (datos.marketingOptIn === true && !existing.marketing_opt_in) changes.marketing_opt_in = true
    if (Object.keys(changes).length) {
      // `birthday` puede no existir todavía en despliegues antiguos: si la escritura falla por
      // eso, se guarda el resto en vez de perderlo entero.
      const primero = await db.from('clients').update({ ...changes, updated_at: new Date().toISOString() })
        .eq('id', existing.id).eq('business_id', datos.businessId)
      if (primero.error && 'birthday' in changes) {
        const { birthday, ...resto } = changes
        void birthday
        if (Object.keys(resto).length) {
          await db.from('clients').update({ ...resto, updated_at: new Date().toISOString() })
            .eq('id', existing.id).eq('business_id', datos.businessId)
        }
      }
    }
    return { ok: true, created: false, client: { ...existing, ...changes } }
  }

  if (!nombre) return { ok: false, estado: 409, error: 'Se necesita el nombre antes de registrar al cliente', motivo: 'DATO_INVALIDO', needsName: true }

  const fila: Record<string, unknown> = {
    business_id: datos.businessId,
    full_name: nombre.slice(0, 200),
    phone: datos.phone,
    email: correo || null,
    marketing_opt_in: datos.marketingOptIn === true,
  }
  if (nacimiento) fila.birthday = nacimiento

  let creado = await db.from('clients').insert(fila).select('id,full_name,phone,email,birthday,marketing_opt_in').single()
  if (creado.error && nacimiento) {
    const { birthday, ...sinNacimiento } = fila
    void birthday
    creado = await db.from('clients').insert(sinNacimiento).select('id,full_name,phone,email,marketing_opt_in').single() as typeof creado
  }
  if (creado.error?.code === '23505') {
    const { data: concurrent } = await db.from('clients').select('id,full_name,phone,email,birthday,marketing_opt_in')
      .eq('business_id', datos.businessId).eq('phone', datos.phone).single()
    return { ok: true, created: false, client: (concurrent ?? {}) as Record<string, unknown> }
  }
  if (creado.error || !creado.data) return { ok: false, estado: 500, error: 'No se pudo registrar el cliente', motivo: 'ERROR_TECNICO' }

  if (datos.marketingOptIn === true) {
    const channels = ['WHATSAPP', ...(creado.data.email ? ['EMAIL'] : [])]
    await db.from('communication_consents').insert(channels.map((channel) => ({
      client_id: creado.data.id, channel, purpose: 'MARKETING', granted: true, source: 'AI_AGENT',
    })))
  }
  return { ok: true, created: true, client: creado.data as Record<string, unknown> }
}
