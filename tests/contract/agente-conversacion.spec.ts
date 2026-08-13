import { test, expect } from '@playwright/test'
import { POST as POST_slots } from '@/app/api/agent/slots/route'
import { POST as POST_book } from '@/app/api/agent/book/route'
import { POST as POST_clients } from '@/app/api/agent/clients/route'
import { POST as POST_appointments } from '@/app/api/agent/appointments/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'
import { promptDelSistema } from '../support/n8n'

/**
 * Batería conversacional: conversaciones reales, turno por turno, contra las rutas de verdad.
 *
 * Las demás pruebas de contrato miran una pieza cada una. Esta mira el **recorrido completo**
 * que hace el agente en una conversación de WhatsApp, en el mismo orden en que lo hace el
 * workflow 01, y comprueba las reglas que solo se rompen entre turno y turno:
 *
 *  - No hay reserva sin apartado. El agente **no puede** confirmar una hora que no apartó
 *    (CLAUDE.md §1, "flujo del agente"): sin `holdId` la ruta contesta 400, y con un `holdId`
 *    vencido o de otro horario contesta 409 con `conflict:true` — la señal que el prompt usa
 *    para reconsultar en vez de inventar una confirmación fantasma.
 *  - El equipo solo consulta. Un profesional o un administrativo escribiendo por WhatsApp
 *    rebota con 403 en buscar horarios, reservar y registrarse como cliente.
 *  - Solo se atiende a teléfonos de verdad. Un grupo de WhatsApp (JID de 18 dígitos) nunca
 *    llega a crear un cliente ni a tocar reservas.
 *
 * Todo corre contra el doble de PostgREST: sin base de datos, sin red y sin modelo.
 */

const NEGOCIO = 'negocio-1'
const SERVICIO = 'servicio-corte'
const PROFESIONAL = 'profesional-ana'
const CLIENTE = 'cliente-1'
const TELEFONO = '56911112222'
const TELEFONO_EQUIPO = '56999998888'
/** JID de un grupo de WhatsApp: 18 dígitos, imposible como teléfono E.164. */
const GRUPO = '120363111222333444'

/** Una hora futura estable dentro de la ejecución de la prueba. */
const EN_DOS_DIAS = new Date(Date.now() + 2 * 86400000)
const INICIO = new Date(EN_DOS_DIAS.setUTCHours(15, 0, 0, 0)).toISOString()
const FIN = new Date(new Date(INICIO).getTime() + 45 * 60000).toISOString()
const VENTANA = { from: new Date(Date.now() + 86400000).toISOString(), until: new Date(Date.now() + 5 * 86400000).toISOString() }

let falso: SupabaseFalso

const holdVigente = (extra: Record<string, unknown> = {}) => ({
  id: 'hold-1',
  business_id: NEGOCIO,
  professional_id: PROFESIONAL,
  service_id: SERVICIO,
  period: `["${INICIO}","${FIN}")`,
  expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
  ...extra,
})

const datos = (extra: Tablas = {}): Tablas => ({
  businesses: [{ id: NEGOCIO, active: true, timezone: 'America/Santiago', settings: { booking_interval_minutes: 15 } }],
  services: [{ id: SERVICIO, business_id: NEGOCIO, name: 'Corte de pelo', buffer_before_minutes: 0 }],
  professionals: [{ id: PROFESIONAL, business_id: NEGOCIO, active: true, display_name: 'Ana', phone: null, member_id: null }],
  business_members: [],
  clients: [],
  appointment_holds: [],
  communication_consents: [],
  ...extra,
})

/** El agente busca horarios: `find_service_slots` devuelve dos, y cada uno se aparta. */
function conHorariosDisponibles(estado: SupabaseFalso) {
  estado.respuestasRpc.find_service_slots = () => [
    { professional_id: PROFESIONAL, service_start: INICIO, service_end: FIN },
    { professional_id: PROFESIONAL, service_start: new Date(new Date(INICIO).getTime() + 3600000).toISOString(), service_end: new Date(new Date(FIN).getTime() + 3600000).toISOString() },
  ]
  let apartados = 0
  estado.respuestasRpc.create_slot_hold = (argumentos: any, tablas: Tablas) => {
    apartados += 1
    const hold = holdVigente({
      id: `hold-${apartados}`,
      professional_id: argumentos.p_professional_id,
      period: `["${argumentos.p_desired_start}","${FIN}")`,
    })
    tablas.appointment_holds = [...(tablas.appointment_holds ?? []), hold]
    return { id: hold.id, expires_at: hold.expires_at }
  }
}

const llamar = async (handler: (peticion: Request) => Promise<Response>, ruta: string, cuerpo: Record<string, unknown>) => {
  const respuesta = await handler(peticionAgente(`http://localhost/api/agent/${ruta}`, cuerpo))
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, any> }
}

const buscarHorarios = (cuerpo: Record<string, unknown>) => llamar(POST_slots, 'slots', cuerpo)
const reservar = (cuerpo: Record<string, unknown>) => llamar(POST_book, 'book', cuerpo)
const registrarCliente = (cuerpo: Record<string, unknown>) => llamar(POST_clients, 'clients', cuerpo)
const misReservas = (cuerpo: Record<string, unknown>) => llamar(POST_appointments, 'appointments', cuerpo)

/** Cuántas veces se llamó a la función SQL que crea la reserva de verdad. */
const vecesQueSeReservo = () => falso.rpc.filter((llamada) => llamada.nombre === 'confirm_held_appointment').length

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso(datos())
  usarSupabaseFalso(falso)
})

test.afterEach(async () => {
  await falso.cerrar()
})

test.describe('Conversación 1 — "Hola, quiero una hora de corte"', () => {
  test('el recorrido completo: registrar, buscar horarios apartados y confirmar', async () => {
    // Turno 1: el cliente saluda y el agente intenta registrarlo, pero todavía no sabe el nombre.
    const sinNombre = await registrarCliente({ businessId: NEGOCIO, phone: TELEFONO })
    expect(sinNombre.estado).toBe(409)
    expect(sinNombre.cuerpo.needsName).toBe(true)

    // Turno 2: el cliente dice cómo se llama.
    falso.respuestasRpc.noop = () => null
    const registrado = await registrarCliente({ businessId: NEGOCIO, phone: TELEFONO, fullName: 'Camila Rojas' })
    expect(registrado.estado).toBe(201)
    expect(registrado.cuerpo.created).toBe(true)
    const clientId = registrado.cuerpo.client.id

    // Turno 3: pide hora. El agente busca y el sistema aparta hasta 3 cupos.
    conHorariosDisponibles(falso)
    const horarios = await buscarHorarios({ businessId: NEGOCIO, serviceId: SERVICIO, ...VENTANA, clientId, contactKey: TELEFONO })
    expect(horarios.estado).toBe(200)
    expect(horarios.cuerpo.slots.length).toBeGreaterThan(0)
    expect(horarios.cuerpo.holdMinutes).toBe(15)
    // Cada horario ofrecido viene con su apartado: el agente nunca ofrece algo que no reservó.
    for (const slot of horarios.cuerpo.slots) expect(slot.holdId).toBeTruthy()

    // Turno 4: "sí, esa". Se confirma con el apartado, nunca con la hora suelta.
    const elegido = horarios.cuerpo.slots[0]
    falso.respuestasRpc.confirm_held_appointment = () => ({ id: 'reserva-1', status: 'SCHEDULED' })
    const reserva = await reservar({
      businessId: NEGOCIO, clientId, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: elegido.service_start, holdId: elegido.holdId, actorPhone: TELEFONO,
    })

    expect(reserva.estado).toBe(201)
    expect(reserva.cuerpo.booked).toBe(true)
    expect(reserva.cuerpo.appointment.id).toBe('reserva-1')
    expect(vecesQueSeReservo()).toBe(1)
  })
})

test.describe('Conversación 2 — el cupo se ocupó mientras el cliente pensaba', () => {
  test('un apartado vencido devuelve 409 con conflict, y no reserva nada', async () => {
    falso.tablas.appointment_holds = [holdVigente({ expires_at: new Date(Date.now() - 60000).toISOString() })]
    falso.respuestasRpc.confirm_held_appointment = () => ({ id: 'no-deberia-existir' })

    const { estado, cuerpo } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: INICIO, holdId: 'hold-1', actorPhone: TELEFONO,
    })

    expect(estado).toBe(409)
    expect(cuerpo.conflict).toBe(true)
    expect(cuerpo.booked).toBeUndefined()
    expect(vecesQueSeReservo()).toBe(0)
  })

  test('un apartado que ya no existe se trata igual que uno vencido', async () => {
    falso.tablas.appointment_holds = []
    const { estado, cuerpo } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: INICIO, holdId: 'hold-que-no-existe', actorPhone: TELEFONO,
    })
    expect(estado).toBe(409)
    expect(cuerpo.conflict).toBe(true)
    expect(vecesQueSeReservo()).toBe(0)
  })

  test('si la función SQL detecta el solape, también sale 409 con conflict', async () => {
    falso.tablas.appointment_holds = [holdVigente()]
    falso.respuestasRpc.confirm_held_appointment = () => {
      const error = new Error('conflicting key value violates exclusion constraint') as Error & { code: string }
      error.code = '23P01'
      throw error
    }

    const { estado, cuerpo } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: INICIO, holdId: 'hold-1', actorPhone: TELEFONO,
    })

    expect(estado).toBe(409)
    expect(cuerpo.conflict).toBe(true)
    expect(cuerpo.booked).toBeUndefined()
  })
})

test.describe('Conversación 3 — el modelo se salta el apartado', () => {
  test('sin holdId no se reserva: 400 y ninguna llamada a la función SQL', async () => {
    const { estado, cuerpo } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: INICIO, actorPhone: TELEFONO,
    })
    expect(estado).toBe(400)
    expect(cuerpo.booked).toBeUndefined()
    expect(vecesQueSeReservo()).toBe(0)
  })

  test('con un horario distinto al apartado tampoco: 409 con conflict', async () => {
    falso.tablas.appointment_holds = [holdVigente()]
    const unaHoraDespues = new Date(new Date(INICIO).getTime() + 3600000).toISOString()

    const { estado, cuerpo } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: unaHoraDespues, holdId: 'hold-1', actorPhone: TELEFONO,
    })

    expect(estado).toBe(409)
    expect(cuerpo.conflict).toBe(true)
    expect(vecesQueSeReservo()).toBe(0)
  })

  test('una fecha en el pasado se rechaza antes de tocar la base', async () => {
    const ayer = new Date(Date.now() - 86400000).toISOString()
    const { estado } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: ayer, holdId: 'hold-1', actorPhone: TELEFONO,
    })
    expect(estado).toBe(400)
    expect(vecesQueSeReservo()).toBe(0)
  })

  test('el apartado tiene que ser del mismo negocio, profesional y servicio', async () => {
    falso.tablas.appointment_holds = [holdVigente({ service_id: 'otro-servicio' })]
    const { estado, cuerpo } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: INICIO, holdId: 'hold-1', actorPhone: TELEFONO,
    })
    expect(estado).toBe(409)
    expect(cuerpo.conflict).toBe(true)
    expect(vecesQueSeReservo()).toBe(0)
  })
})

test.describe('Conversación 4 — escribe alguien del equipo', () => {
  test.beforeEach(() => {
    falso.tablas.professionals = [{ id: PROFESIONAL, business_id: NEGOCIO, active: true, display_name: 'Ana', phone: `+${TELEFONO_EQUIPO}`, member_id: 'miembro-1' }]
  })

  test('buscar horarios rebota con 403 y no aparta nada', async () => {
    conHorariosDisponibles(falso)
    const { estado, cuerpo } = await buscarHorarios({ businessId: NEGOCIO, serviceId: SERVICIO, ...VENTANA, contactKey: TELEFONO_EQUIPO })
    expect(estado).toBe(403)
    expect(cuerpo.error).toContain('solo puede consultar')
    expect(falso.rpc.some((llamada) => llamada.nombre === 'create_slot_hold')).toBe(false)
  })

  test('reservar rebota con 403 antes de tocar la función SQL', async () => {
    falso.tablas.appointment_holds = [holdVigente()]
    const { estado } = await reservar({
      businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO,
      desiredStart: INICIO, holdId: 'hold-1', actorPhone: TELEFONO_EQUIPO,
    })
    expect(estado).toBe(403)
    expect(vecesQueSeReservo()).toBe(0)
  })

  test('el equipo no se puede registrar como cliente', async () => {
    const { estado } = await registrarCliente({ businessId: NEGOCIO, phone: TELEFONO_EQUIPO, fullName: 'Ana (desde su celular)' })
    expect(estado).toBe(403)
    expect(falso.tablas.clients).toHaveLength(0)
  })

  test('liberar una reserva también rebota, pero consultar no', async () => {
    const liberar = await misReservas({ businessId: NEGOCIO, phone: TELEFONO_EQUIPO, action: 'release', appointmentId: 'reserva-1' })
    expect(liberar.estado).toBe(403)

    // `list` es consulta: no rebota por ser del equipo, se corta más adelante por no ser cliente.
    const consultar = await misReservas({ businessId: NEGOCIO, phone: TELEFONO_EQUIPO, action: 'list' })
    expect(consultar.estado).not.toBe(403)
  })

  test('un administrativo sin ficha de profesional también es equipo', async () => {
    falso.tablas.professionals = [{ id: PROFESIONAL, business_id: NEGOCIO, active: true, display_name: 'Ana', phone: null, member_id: null }]
    falso.tablas.business_members = [{ id: 'miembro-2', business_id: NEGOCIO, active: true, role: 'RECEPTIONIST', agent_phone: `+${TELEFONO_EQUIPO}`, agent_display_name: 'Recepción' }]

    const { estado } = await registrarCliente({ businessId: NEGOCIO, phone: TELEFONO_EQUIPO, fullName: 'Recepción' })
    expect(estado).toBe(403)
  })
})

test.describe('Conversación 5 — el mensaje viene de un grupo de WhatsApp', () => {
  test('el JID del grupo no crea un cliente', async () => {
    const { estado, cuerpo } = await registrarCliente({ businessId: NEGOCIO, phone: GRUPO, fullName: 'Grupo Familia' })
    expect(estado).toBe(400)
    expect(cuerpo.error).toBe('Negocio o teléfono inválido')
    expect(falso.tablas.clients).toHaveLength(0)
  })

  test('el JID del grupo tampoco toca reservas', async () => {
    for (const action of ['list', 'confirm', 'release']) {
      const { estado } = await misReservas({ businessId: NEGOCIO, phone: GRUPO, action, appointmentId: 'reserva-1' })
      expect(estado, action).toBe(400)
    }
  })

  test('un número demasiado corto tampoco pasa por cliente', async () => {
    const { estado } = await registrarCliente({ businessId: NEGOCIO, phone: '12345', fullName: 'Nadie' })
    expect(estado).toBe(400)
  })
})

test.describe('Conversación 6 — el cliente ya existía', () => {
  test('volver a escribir no duplica la ficha ni pierde el nombre', async () => {
    falso.tablas.clients = [{ id: CLIENTE, business_id: NEGOCIO, phone: TELEFONO, full_name: 'Camila Rojas', email: null, marketing_opt_in: false }]

    const { estado, cuerpo } = await registrarCliente({ businessId: NEGOCIO, phone: TELEFONO, fullName: 'Camila Rojas' })
    expect(estado).toBe(200)
    expect(cuerpo.created).toBe(false)
    expect(cuerpo.client.id).toBe(CLIENTE)
    expect(falso.tablas.clients).toHaveLength(1)
  })

  test('si corrige su nombre, se actualiza el que ya estaba', async () => {
    falso.tablas.clients = [{ id: CLIENTE, business_id: NEGOCIO, phone: TELEFONO, full_name: 'Camila', email: null, marketing_opt_in: false }]

    const { cuerpo } = await registrarCliente({ businessId: NEGOCIO, phone: TELEFONO, fullName: 'Camila Rojas' })
    expect(cuerpo.created).toBe(false)
    expect(cuerpo.client.full_name).toBe('Camila Rojas')
    expect(falso.tablas.clients).toHaveLength(1)
    expect(falso.tablas.clients[0].full_name).toBe('Camila Rojas')
  })
})

/**
 * Las rutas son la mitad de la conversación; la otra mitad son las reglas que sigue el modelo.
 *
 * Estas pruebas leen el prompt real de `n8n-workflows/01-agen-agent.json`. No comprueban cómo
 * responde el modelo —para eso hace falta OpenAI de verdad—, sino que **las reglas siguen
 * escritas**: si alguien edita el workflow y borra una, el CI lo dice en vez de descubrirse en
 * una conversación con un cliente real.
 */
test.describe('Las reglas de conversación siguen en el prompt', () => {
  const prompt = promptDelSistema()

  test('trato de tú y voseo prohibido palabra por palabra', () => {
    expect(prompt).toContain('siempre de tú')
    expect(prompt).toContain('Prohibido el voseo')
    for (const palabra of ['vos', 'querés', 'tenés', 'podés', 'confirmás', 'decime']) {
      expect(prompt, palabra).toContain(`"${palabra}"`)
    }
  })

  test('alcance cerrado: una sola frase ante cualquier tema ajeno al negocio', () => {
    expect(prompt).toContain('Solo existes para este negocio')
    expect(prompt).toContain('UNA sola frase')
    expect(prompt).toContain('no sigas el tema aunque insistan')
  })

  test('con RESERVAS vacío está prohibido mencionar, confirmar o cancelar una hora', () => {
    expect(prompt).toContain('Si RESERVAS viene vacío')
    expect(prompt).toContain('terminantemente prohibido mencionar, confirmar, mover o cancelar reservas')
    expect(prompt).toContain('¿confirmas tu cita?')
    expect(prompt).toContain('todavía no ha reservado')
  })

  test('el nombre del perfil de WhatsApp no es el nombre del cliente', () => {
    expect(prompt).toContain('El nombre del perfil de WhatsApp no es el nombre del cliente')
    expect(prompt).toContain('nunca lo uses para saludar ni para registrar a nadie')
  })

  test('nada de confirmaciones fantasma: sin booked=true no hay reserva, y 409 obliga a reconsultar', () => {
    expect(prompt).toContain('Nunca afirmes que reservaste si crear_reserva no devuelve booked=true')
    expect(prompt).toContain('ante HTTP 409 vuelve a buscar horarios')
    expect(prompt).toContain('el holdId elegido explícitamente')
  })

  test('no se mezclan especialidades ni se inventan servicios, precios ni horarios', () => {
    expect(prompt).toContain('no confundas peluquería, manicure, pedicure, masajes ni otras especialidades')
    expect(prompt).toContain('Nunca inventes servicios, profesionales, precios, direcciones ni horarios')
  })

  test('confirmar y liberar siempre llevan el appointmentId de esa reserva', () => {
    expect(prompt).toContain('llama mis_reservas')
    expect(prompt).toContain('SIEMPRE llevan el appointmentId')
    expect(prompt).toContain('Nunca liberes una hora que el cliente no haya pedido liberar')
    expect(prompt).toContain('alreadyDone')
  })

  test('el modo equipo es solo lectura también en el prompt, no solo en las API', () => {
    expect(prompt).toContain('El modo TEAM es solo lectura')
    expect(prompt).toContain('las API también lo bloquean')
  })

  test('la regla de salida: solo el mensaje del cliente, sin IDs internos ni inglés', () => {
    expect(prompt).toContain('REGLA DE SALIDA')
    expect(prompt).toContain('Nunca escribas tu razonamiento')
    expect(prompt).toContain('holdId')
    expect(prompt).toContain('Nada de texto en inglés')
  })

  test('el motivo de un cambio se explica tal como llegó, nunca se inventa', () => {
    expect(prompt).toContain('explícale el motivo tal como aparece en el aviso')
    expect(prompt).toContain('nunca inventes un motivo')
  })
})

test.describe('Toda la batería exige el secreto compartido', () => {
  test('sin el secreto, ninguna herramienta del agente responde', async () => {
    const rutas: Array<[string, (peticion: Request) => Promise<Response>, Record<string, unknown>]> = [
      ['slots', POST_slots, { businessId: NEGOCIO, serviceId: SERVICIO, ...VENTANA, contactKey: TELEFONO }],
      ['book', POST_book, { businessId: NEGOCIO, clientId: CLIENTE, professionalId: PROFESIONAL, serviceId: SERVICIO, desiredStart: INICIO, holdId: 'hold-1', actorPhone: TELEFONO }],
      ['clients', POST_clients, { businessId: NEGOCIO, phone: TELEFONO, fullName: 'Camila' }],
      ['appointments', POST_appointments, { businessId: NEGOCIO, phone: TELEFONO, action: 'list' }],
    ]

    for (const [nombre, handler, cuerpo] of rutas) {
      const respuesta = await handler(peticionAgente(`http://localhost/api/agent/${nombre}`, cuerpo, 'POST', 'secreto-equivocado'))
      expect(respuesta.status, nombre).toBe(401)
    }
    expect(falso.rpc).toHaveLength(0)
  })
})
