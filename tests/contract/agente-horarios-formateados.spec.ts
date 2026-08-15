import { test, expect } from '@playwright/test'
import { POST } from '@/app/api/agent/slots/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'
import { cargarWorkflow } from '../support/n8n'

/**
 * Los horarios que se le ofrecen al cliente llevan el día y la hora YA resueltos.
 *
 * El fallo, de una conversación real: `service_start` viaja en UTC, y el modelo tiene que
 * convertirlo a la zona del negocio para nombrarlo. Unas veces salía bien y otras no — con
 * horarios de las 09:00 locales (13:00 UTC) le dijo al cliente "el martes 17 a las 13:00 en la
 * tarde": ni el día, ni la hora, ni la franja eran ciertos. Y el cliente no tiene forma de
 * saberlo hasta que llega al local.
 *
 * Pedirle aritmética de husos a un modelo es pedirle que acierte casi siempre. La zona la
 * resuelve el servidor (CLAUDE.md §1), igual que ya se hacía con las reservas del cliente.
 */

const NEGOCIO = 'negocio-1'
const SERVICIO = 'servicio-corte'
const PROFESIONAL = 'profesional-ana'
const TELEFONO = '56911112222'

/** Lunes 17 de agosto de 2026, 13:00 UTC = 09:00 en Santiago (UTC-4 en agosto). */
const INICIO_MANANA = '2026-08-17T13:00:00+00:00'
/** Mismo día, 18:00 UTC = 14:00 en Santiago. */
const INICIO_TARDE = '2026-08-17T18:00:00+00:00'

let falso: SupabaseFalso

const datos = (): Tablas => ({
  businesses: [{ id: NEGOCIO, active: true, timezone: 'America/Santiago', settings: { booking_interval_minutes: 15 } }],
  professionals: [{ id: PROFESIONAL, business_id: NEGOCIO, active: true, display_name: 'Ana', phone: null, member_id: null }],
  business_members: [],
  appointment_holds: [],
  clients: [],
})

const buscar = () => POST(peticionAgente('http://localhost/api/agent/slots', {
  businessId: NEGOCIO,
  serviceId: SERVICIO,
  from: '2026-08-17T00:00:00',
  until: '2026-08-18T00:00:00',
  contactKey: TELEFONO,
}))

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso(datos())
  usarSupabaseFalso(falso)
  falso.respuestasRpc.find_service_slots = () => [
    { professional_id: PROFESIONAL, professional_name: 'Ana', service_id: SERVICIO, service_start: INICIO_MANANA, service_end: '2026-08-17T13:45:00+00:00', quoted_price: 15000 },
    { professional_id: PROFESIONAL, professional_name: 'Ana', service_id: SERVICIO, service_start: INICIO_TARDE, service_end: '2026-08-17T18:45:00+00:00', quoted_price: 15000 },
  ]
  falso.respuestasRpc.create_slot_hold = (argumentos) => ({
    id: `hold-${argumentos.p_desired_start}`,
    expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
  })
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('El día y la hora vienen resueltos, no en UTC', () => {
  test('las 13:00 UTC se ofrecen como las 09:00, que es la hora real del negocio', async () => {
    const { slots } = await (await buscar()).json()
    expect(slots[0].hora).toBe('09:00')
    expect(slots[0].fecha).toBe('2026-08-17')
  })

  test('el nombre del día es el del negocio, no el del huso del servidor', async () => {
    const { slots } = await (await buscar()).json()
    // 17 de agosto de 2026 es lunes: si el agente dice "martes", el cliente va el día que no es.
    expect(String(slots[0].dia).toLowerCase()).toContain('lunes')
    expect(String(slots[0].dia)).toContain('17')
  })

  test('la franja la decide el servidor, no el modelo', async () => {
    const { slots } = await (await buscar()).json()
    expect(slots[0].franja, 'las 09:00 son de mañana').toBe('mañana')
    expect(slots[1].franja, 'las 14:00 son de tarde').toBe('tarde')
  })

  test('sigue viajando el apartado y el instante original', async () => {
    // El `service_start` en UTC no se quita: es lo que se manda de vuelta al reservar.
    const { slots, zona } = await (await buscar()).json()
    expect(slots[0].service_start).toBe(INICIO_MANANA)
    expect(slots[0].holdId).toBeTruthy()
    expect(zona).toBe('America/Santiago')
  })
})

test.describe('La herramienta del workflow también los resuelve', () => {
  /*
   * La app los devuelve resueltos, pero eso solo llega con el siguiente despliegue. La
   * herramienta de n8n hace la misma conversión, así que el arreglo vale HOY y sigue siendo
   * correcto después: si los campos ya vienen de la app, no los toca.
   *
   * Comprobado en producción: con la herramienta arreglada, el agente pasó de decir
   * "el martes 17 de agosto a las 13:00" (era lunes, y eran las 09:00) a decir
   * "Lunes, 17 de agosto — 09:45".
   */
  const codigo = String((
    cargarWorkflow().nodes.find((n) => n.name === 'buscar_horarios')!.parameters as { jsCode: string }
  ).jsCode)

  test('convierte con Intl y la zona del negocio, no con aritmética a mano', () => {
    expect(codigo).toContain('Intl.DateTimeFormat')
    expect(codigo).toContain('timeZone: zona')
    // Un offset escrito a mano se rompe con el horario de verano.
    expect(codigo).not.toMatch(/[+-]\s*4\s*\*\s*3600/)
  })

  test('añade día, hora, fecha y franja', () => {
    for (const campo of ['hora', 'dia', 'fecha', 'franja']) expect(codigo).toContain(campo)
  })

  test('respeta lo que ya venga resuelto de la app', () => {
    expect(codigo).toContain('if (s && s.hora && s.dia) return s;')
  })

  test('si algo falla, devuelve los horarios igual en vez de romper el turno', () => {
    // Un fallo al formatear no puede dejar al cliente sin respuesta: es cosmético.
    expect(codigo).toContain('catch (e) {}')
  })
})

test.describe('La ventana de búsqueda se lee en la zona del negocio', () => {
  test('una ventana sin zona no se interpreta en UTC', async () => {
    // `from: "2026-08-17T00:00:00"` es medianoche EN SANTIAGO: 04:00 UTC.
    await buscar()
    const llamada = falso.rpc.find((item) => item.nombre === 'find_service_slots')
    expect(llamada?.argumentos.p_from).toBe('2026-08-17T04:00:00.000Z')
  })
})
