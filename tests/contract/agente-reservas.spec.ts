import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  confirmClientAppointment,
  findClientAppointment,
  listClientAppointments,
  releaseClientAppointment,
  requiereIdDeReserva,
  type ReservaDelCliente,
} from '@/lib/agent-appointments'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Idempotencia de las mutaciones que el agente hace sobre las reservas del cliente
 * (`@/lib/agent-appointments`, usado por `/api/agent/appointments`).
 *
 * El riesgo real: `liberar_reserva` es un nodo con reintento. Si la cancelación llegó a
 * aplicarse y la respuesta se perdió, el reintento no puede terminar cancelando otra hora
 * del mismo cliente ni volver a cancelar la misma.
 */

const NEGOCIO = '4cb0d138-6180-4842-8a88-1f633b08de5c'
const CLIENTE = 'cliente-1'

let falso: SupabaseFalso
let db: SupabaseClient

const reserva = (id: string, dia: number, estado = 'PENDING', confirmada: string | null = null) => ({
  id,
  business_id: NEGOCIO,
  client_id: CLIENTE,
  status: estado,
  client_confirmed_at: confirmada,
  service_period: `[2026-08-2${dia}T13:00:00+00:00,2026-08-2${dia}T14:00:00+00:00)`,
  professional: { display_name: 'Camila Rojas' },
  service: { name: 'Corte y Peinado' },
})

/** Las funciones SQL reales, simuladas: mutan la fila igual que en la base. */
const simularFuncionesSql = () => {
  falso.respuestasRpc.cancel_safe_appointment = (argumentos, tablas) => {
    const fila = (tablas.appointments ?? []).find((item) => item.id === argumentos.p_appointment_id)
    if (!fila) throw Object.assign(new Error('Reserva inexistente'), { code: 'P0002' })
    if (!['PENDING', 'CONFIRMED'].includes(fila.status)) throw Object.assign(new Error('Ya no se puede cancelar'), { code: 'P0001' })
    fila.status = 'CANCELLED'
    return fila
  }
  falso.respuestasRpc.confirm_appointment_by_client = (argumentos, tablas) => {
    const fila = (tablas.appointments ?? []).find((item) => item.id === argumentos.p_appointment_id)
    if (!fila) throw Object.assign(new Error('Reserva inexistente'), { code: 'P0002' })
    if (!['PENDING', 'CONFIRMED'].includes(fila.status)) throw Object.assign(new Error('Ya no se puede confirmar'), { code: 'P0001' })
    fila.status = 'CONFIRMED'
    fila.client_confirmed_at = '2026-08-12T12:00:00.000Z'
    return fila
  }
}

const llamadas = (nombre: string) => falso.rpc.filter((item) => item.nombre === nombre)
const estado = (id: string) => (falso.tablas.appointments ?? []).find((item) => item.id === id)?.status

const buscar = async (appointmentId: string) => {
  const { reserva: encontrada } = await findClientAppointment(db, { businessId: NEGOCIO, clientId: CLIENTE, appointmentId })
  return encontrada
}

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ appointments: [reserva('cita-A', 1), reserva('cita-B', 2)] })
  simularFuncionesSql()
  db = createClient(falso.url, 'clave-de-prueba', { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Una mutación identifica siempre la reserva exacta', () => {
  test('confirmar y liberar exigen el id de la reserva', () => {
    expect(requiereIdDeReserva('release')).toBe(true)
    expect(requiereIdDeReserva('confirm')).toBe(true)
    expect(requiereIdDeReserva('list')).toBe(false)
  })

  test('un id que no es de este cliente no cae en otra reserva', async () => {
    const ajena = await findClientAppointment(db, { businessId: NEGOCIO, clientId: 'otro-cliente', appointmentId: 'cita-A' })
    expect(ajena.reserva).toBeNull()
  })

  test('un id inexistente no cae en "la más próxima"', async () => {
    const inexistente = await findClientAppointment(db, { businessId: NEGOCIO, clientId: CLIENTE, appointmentId: 'cita-que-no-existe' })
    expect(inexistente.reserva, 'nunca debe resolverse a otra reserva del cliente').toBeNull()
  })

  test('una reserva de otro negocio tampoco se alcanza', async () => {
    const ajena = await findClientAppointment(db, { businessId: 'otro-negocio', clientId: CLIENTE, appointmentId: 'cita-A' })
    expect(ajena.reserva).toBeNull()
  })
})

test.describe('Liberar la reserva es idempotente', () => {
  test('el reintento no cancela una segunda vez ni toca otra reserva', async () => {
    const objetivo = await buscar('cita-A')
    const primera = await releaseClientAppointment(db, objetivo as ReservaDelCliente, 'No puedo ese día')

    // El reintento llega con la MISMA reserva que resolvió la primera llamada.
    const releida = await buscar('cita-A')
    const reintento = await releaseClientAppointment(db, releida as ReservaDelCliente, 'No puedo ese día')

    expect(primera).toEqual({ ok: true, yaEstaba: false })
    expect(reintento, 'el reintento tiene que reconocer que ya se aplicó').toEqual({ ok: true, yaEstaba: true })
    expect(llamadas('cancel_safe_appointment'), 'no puede haber una segunda cancelación').toHaveLength(1)
    expect(estado('cita-A')).toBe('CANCELLED')
    expect(estado('cita-B'), 'la otra reserva del cliente no se toca jamás').toBe('PENDING')
  })

  test('dos reintentos concurrentes: una sola cancelación', async () => {
    const objetivo = await buscar('cita-A')
    await Promise.all([
      releaseClientAppointment(db, objetivo as ReservaDelCliente, 'No puedo'),
      releaseClientAppointment(db, objetivo as ReservaDelCliente, 'No puedo'),
    ])
    // La segunda llega a la función SQL, que la rechaza por estado: la reserva queda
    // cancelada una sola vez y la de al lado, intacta.
    expect(estado('cita-A')).toBe('CANCELLED')
    expect(estado('cita-B')).toBe('PENDING')
  })

  test('una reserva ya cancelada no se vuelve a cancelar', async () => {
    falso.tablas.appointments = [reserva('cita-A', 1, 'CANCELLED')]
    const objetivo = await buscar('cita-A')

    const resultado = await releaseClientAppointment(db, objetivo as ReservaDelCliente, 'No puedo')

    expect(resultado).toEqual({ ok: true, yaEstaba: true })
    expect(llamadas('cancel_safe_appointment')).toHaveLength(0)
  })

  test('una reserva ya cumplida no se puede liberar', async () => {
    falso.tablas.appointments = [reserva('cita-A', 1, 'COMPLETED')]
    const objetivo = await buscar('cita-A')

    expect(await releaseClientAppointment(db, objetivo as ReservaDelCliente, 'No puedo')).toEqual({ ok: false, motivo: 'no_vigente' })
    expect(llamadas('cancel_safe_appointment')).toHaveLength(0)
  })
})

test.describe('Confirmar la reserva es idempotente', () => {
  test('el reintento no vuelve a confirmar', async () => {
    const objetivo = await buscar('cita-A')
    const primera = await confirmClientAppointment(db, objetivo as ReservaDelCliente)

    const releida = await buscar('cita-A')
    const reintento = await confirmClientAppointment(db, releida as ReservaDelCliente)

    expect(primera).toEqual({ ok: true, yaEstaba: false })
    expect(reintento).toEqual({ ok: true, yaEstaba: true })
    expect(llamadas('confirm_appointment_by_client')).toHaveLength(1)
    expect(estado('cita-B')).toBe('PENDING')
  })

  test('una reserva cancelada no se puede confirmar', async () => {
    falso.tablas.appointments = [reserva('cita-A', 1, 'CANCELLED')]
    const objetivo = await buscar('cita-A')

    expect(await confirmClientAppointment(db, objetivo as ReservaDelCliente)).toEqual({ ok: false, motivo: 'no_vigente' })
    expect(llamadas('confirm_appointment_by_client')).toHaveLength(0)
  })
})

test.describe('Listar sigue devolviendo solo lo vigente del cliente', () => {
  test('devuelve las reservas del cliente ordenadas', async () => {
    const { data } = await listClientAppointments(db, { businessId: NEGOCIO, clientId: CLIENTE })
    expect((data as unknown as ReservaDelCliente[]).map((item) => item.id)).toEqual(['cita-A', 'cita-B'])
  })
})
