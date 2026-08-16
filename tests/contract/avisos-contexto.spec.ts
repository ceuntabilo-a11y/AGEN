import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { POST as POST_despachar } from '@/app/api/automation/notifications/dispatch/route'
import { POST as POST_contexto } from '@/app/api/agent/context/route'
import { buildNotification } from '@/lib/notification-templates'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Cuando AGEN escribe primero, la respuesta tiene que encontrar su pregunta.
 *
 * El fallo real, visto en producción: el recordatorio decía «Responde Sí para confirmar que
 * vienes. Si no puedes, responde NO…», el cliente escribió «No» y el agente contestó «¿A qué
 * te refieres con "no"?». La cola de avisos se procesaba y se olvidaba, así que la palabra
 * llegaba sin contexto ninguno.
 *
 * Lo que se fija acá:
 * 1. Cada mensaje automático declara qué respuesta espera y qué significa un sí y un no.
 * 2. Un aviso ENTREGADO queda registrado; uno que falló, no (lo que no llegó no se contesta).
 * 3. El turno siguiente del agente ve ese aviso, con la reserva de la que habla.
 * 4. Un aviso caducado o ya respondido deja de aparecer.
 */

const NEGOCIO = 'negocio-1'
const TELEFONO = '56911112222'
const CITA = 'cita-1'
const MANANA = new Date(Date.now() + 20 * 3600_000).toISOString()

let falso: SupabaseFalso
let evolution: Server
let mensajesEnviados: number

const datosBase = (extra: Tablas = {}): Tablas => ({
  businesses: [{
    id: NEGOCIO, active: true, name: 'Bella Vida', timezone: 'America/Santiago',
    currency: 'CLP', address: 'Av. Siempre Viva 742', phone: '+56222222222', email: null,
    maps_url: null, settings: {}, agent_settings: {},
    whatsapp_provider: 'EVOLUTION', whatsapp_instance: 'bella', whatsapp_phone_id: null,
    whatsapp_token: null, whatsapp_360_api_key: null,
  }],
  specialties: [],
  services: [{ id: 'srv-1', business_id: NEGOCIO, active: true, name: 'Corte', description: null, duration_minutes: 45, price: 15000, deposit_amount: 0 }],
  branches: [],
  clients: [{ id: 'cli-1', business_id: NEGOCIO, phone: TELEFONO, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
  professionals: [],
  business_members: [],
  appointments: [{
    id: CITA, business_id: NEGOCIO, client_id: 'cli-1', status: 'PENDING',
    service_period: `["${MANANA}","${MANANA}")`, client_confirmed_at: null,
    professional: { display_name: 'Isidora' }, service: { name: 'Corte' },
  }],
  agent_inbox: [],
  outbound_prompts: [],
  waitlist_entries: [],
  follow_up_tasks: [],
  ...extra,
})

/** Un aviso ya vencido en la cola, listo para que el despachador lo reclame. */
const enCola = (extra: Record<string, unknown> = {}) => ({
  id: 1, business_id: NEGOCIO, appointment_id: CITA, client_id: 'cli-1',
  event_type: 'DAY_OF_REMINDER', channel: 'WHATSAPP', payload: {},
  processed_at: null, claimed_at: null, attempts: 0, last_error: null, ...extra,
})

const simularClaim = () => {
  falso.respuestasRpc.claim_due_notifications = (_argumentos, tablas) => {
    const filas = (tablas.notification_outbox ?? []).filter((fila) => !fila.processed_at)
    for (const fila of filas) { fila.attempts += 1 }
    return filas.map((fila) => ({ ...fila }))
  }
}

const despachar = () => POST_despachar(peticionAgente('http://localhost/api/automation/notifications/dispatch', {}))
const contexto = async (message = 'No') => (await POST_contexto(peticionAgente('http://localhost/api/agent/context', { businessId: NEGOCIO, phone: TELEFONO, message }))).json()
const avisos = () => falso.tablas.outbound_prompts ?? []

test.beforeEach(async () => {
  // Doble de Evolution: el despachador tiene que creerse que el WhatsApp salió, sin red real.
  mensajesEnviados = 0
  evolution = createServer((peticion, respuesta) => {
    peticion.resume()
    mensajesEnviados += 1
    respuesta.writeHead(200, { 'content-type': 'application/json' })
    respuesta.end(JSON.stringify({ key: { id: `msg-${mensajesEnviados}` } }))
  })
  await new Promise<void>((listo) => evolution.listen(0, '127.0.0.1', listo))
  process.env.EVOLUTION_API_URL = `http://127.0.0.1:${(evolution.address() as AddressInfo).port}`
  process.env.EVOLUTION_API_KEY = 'clave-de-prueba'

  falso = await levantarSupabaseFalso(datosBase({ notification_outbox: [enCola()] }))
  usarSupabaseFalso(falso)
  simularClaim()
})

test.afterEach(async () => {
  await falso.cerrar()
  await new Promise<void>((listo) => evolution.close(() => listo()))
})

test.describe('Cada mensaje automático declara qué respuesta espera', () => {
  const negocio = { name: 'Bella Vida', timezone: 'America/Santiago', address: null, maps_url: null }
  const cita = { start: MANANA, end: MANANA, serviceName: 'Corte', professionalName: 'Isidora' }

  const TIPOS = ['BOOKED', 'CHANGED', 'CONFIRM_REQUEST', 'DAY_OF_REMINDER', 'REMINDER_24H', 'REMINDER_2H', 'RESCHEDULED', 'CANCELLED', 'WAITLIST_SLOT', 'FOLLOW_UP', 'REVIEW_REQUEST']

  for (const tipo of TIPOS) {
    test(`${tipo} dice qué se preguntó y cuánto tiempo vale`, () => {
      const armado = buildNotification(tipo, {
        business: negocio, clientName: 'Ana', appointment: cita,
        payload: { slotStart: MANANA },
      })
      expect(armado, `${tipo} tiene que producir un mensaje`).toBeTruthy()
      expect(armado!.espera.question.length, 'sin la pregunta, la respuesta no se puede leer').toBeGreaterThan(10)
      expect(armado!.espera.ttlHours).toBeGreaterThan(0)
    })
  }

  test('un sí a una cancelación NO significa lo mismo que un sí a un cambio de hora', () => {
    // Es el error que más caro sale: confirmar una hora que se acaba de cancelar.
    const cancelado = buildNotification('CHANGED', { business: negocio, appointment: cita, payload: { kind: 'CANCEL' } })
    const movido = buildNotification('CHANGED', { business: negocio, appointment: cita, payload: { kind: 'MOVE' } })

    expect(cancelado!.espera.ifYes).toContain('buscar_horarios')
    expect(cancelado!.espera.ifYes, 'confirmar una hora recién cancelada es el peor error posible').toContain('no llames liberar_reserva ni confirmar_reserva')
    expect(movido!.espera.ifYes).toContain('llama confirmar_reserva')
  })

  test('un no a un recordatorio libera la hora y ofrece otras', () => {
    const recordatorio = buildNotification('DAY_OF_REMINDER', { business: negocio, appointment: cita })
    expect(recordatorio!.espera.expects).toBe('YES_NO')
    expect(recordatorio!.espera.ifNo).toContain('liberar_reserva')
    expect(recordatorio!.espera.ifNo).toContain('buscar_horarios')
  })
})

test.describe('Solo se registra lo que de verdad llegó', () => {
  test('un aviso entregado queda registrado con su pregunta y su reserva', async () => {
    const respuesta = await despachar()
    expect(await respuesta.json()).toMatchObject({ sent: 1 })
    expect(mensajesEnviados, 'el WhatsApp tiene que haber salido').toBe(1)

    expect(avisos()).toHaveLength(1)
    const aviso = avisos()[0]
    expect(aviso.kind).toBe('DAY_OF_REMINDER')
    expect(aviso.appointment_id).toBe(CITA)
    expect(aviso.expects).toBe('YES_NO')
    expect(aviso.question).toContain('SÍ')
    expect(aviso.if_no).toContain('liberar_reserva')
    expect(aviso.answered_at ?? null).toBeNull()
  })

  test('si el envío falla no se registra nada: lo que no llegó no se puede contestar', async () => {
    falso.tablas.businesses[0].whatsapp_instance = null

    const respuesta = await despachar()
    expect(await respuesta.json()).toMatchObject({ failed: 1, sent: 0 })
    expect(avisos()).toHaveLength(0)
  })

  test('un cambio de hora se guarda con su motivo y distinguiendo de una cancelación', async () => {
    falso.tablas.notification_outbox = [enCola({ event_type: 'CHANGED', payload: { kind: 'CANCEL', reason: 'La profesional se enfermó', actor: 'Valentina' } })]

    await despachar()
    const aviso = avisos()[0]
    expect(aviso.kind, 'CHANGED a secas obligaría al agente a adivinar').toBe('CHANGED_CANCEL')
    expect(aviso.summary).toContain('La profesional se enfermó')
    expect(aviso.summary).toContain('Valentina')
  })
})

test.describe('El agente recibe el aviso en su contexto', () => {
  test('el turno siguiente ve qué se le preguntó y de qué reserva se trata', async () => {
    await despachar()
    // El cliente contesta: n8n registra su mensaje antes de pedir el contexto.
    falso.tablas.agent_inbox.push({ id: 1, business_id: NEGOCIO, phone: TELEFONO, message_id: 'wa-1', content: 'No', created_at: new Date().toISOString() })

    const turno = await contexto()
    expect(turno.pendingNotice, 'sin esto el agente responde "¿a qué te refieres con no?"').toBeTruthy()
    expect(turno.pendingNotice.kind).toBe('DAY_OF_REMINDER')
    expect(turno.pendingNotice.appointmentId).toBe(CITA)
    expect(turno.pendingNotice.ifNo).toContain('liberar_reserva')
    expect(turno.pendingNotice.repliesSince, 'es la primera respuesta al aviso').toBe(1)
    expect(turno.pendingNotice.appointment.serviceName).toBe('Corte')
    expect(turno.pendingNotice.appointment.professionalName).toBe('Isidora')
  })

  test('si la conversación ya siguió, el aviso queda como antecedente y no como la pregunta', async () => {
    await despachar()
    const ahora = Date.now()
    falso.tablas.agent_inbox.push(
      { id: 1, business_id: NEGOCIO, phone: TELEFONO, message_id: 'wa-1', content: 'Hola', created_at: new Date(ahora).toISOString() },
      { id: 2, business_id: NEGOCIO, phone: TELEFONO, message_id: 'wa-2', content: '¿Cuánto sale el corte?', created_at: new Date(ahora + 1000).toISOString() },
      { id: 3, business_id: NEGOCIO, phone: TELEFONO, message_id: 'wa-3', content: 'ok', created_at: new Date(ahora + 2000).toISOString() },
    )

    const turno = await contexto()
    expect(turno.pendingNotice.repliesSince).toBe(3)
  })

  test('un aviso ya respondido no vuelve a aparecer', async () => {
    await despachar()
    avisos()[0].answered_at = new Date().toISOString()
    avisos()[0].resolution = 'RELEASED'

    const turno = await contexto()
    expect(turno.pendingNotice).toBeNull()
  })

  test('un aviso caducado no se usa para interpretar nada', async () => {
    await despachar()
    avisos()[0].expires_at = new Date(Date.now() - 3600_000).toISOString()

    const turno = await contexto()
    expect(turno.pendingNotice, 'un "sí" de la semana pasada no confirma la hora de hoy').toBeNull()
  })

  test('sin aviso pendiente el contexto lo dice explícitamente', async () => {
    const turno = await contexto()
    expect(turno).toHaveProperty('pendingNotice')
    expect(turno.pendingNotice).toBeNull()
  })

  test('un recordatorio no sobrevive a la hora de la que habla', async () => {
    // Vence a lo sumo cuando empieza la cita: un "sí" posterior ya no es una confirmación.
    await despachar()
    expect(new Date(avisos()[0].expires_at).getTime()).toBeLessThanOrEqual(new Date(MANANA).getTime())
  })
})

test.describe('El aviso solo aparece cuando el mensaje puede estar contestándolo', () => {
  /*
   * Fallo real en producción: había un seguimiento pendiente («hace tiempo que no vienes,
   * ¿te busco hora?»), el cliente escribió «Hola» y el agente le contestó al seguimiento en vez
   * de saludar. El aviso se entregaba en todos los turnos mientras siguiera vivo.
   */
  test('un saludo NO despierta un seguimiento pendiente', async () => {
    falso.tablas.notification_outbox = [enCola({ event_type: 'FOLLOW_UP' })]
    await despachar()
    expect(avisos()).toHaveLength(1)

    for (const saludo of ['Hola', 'hola!', 'Buenas tardes', 'Hey 👋', 'Buenos días']) {
      const turno = await contexto(saludo)
      expect(turno.pendingNotice, `"${saludo}" no contesta a nada`).toBeNull()
    }
  })

  test('una petición nueva tampoco lo despierta', async () => {
    falso.tablas.notification_outbox = [enCola({ event_type: 'FOLLOW_UP' })]
    await despachar()
    const turno = await contexto('¿Cuánto sale la manicura?')
    expect(turno.pendingNotice).toBeNull()
  })

  test('un sí, un no o una respuesta mixta sí lo traen', async () => {
    await despachar()
    for (const respuesta of ['No', 'sí', 'ok', 'No, mejor cámbiamela para mañana', 'no puedo ir', 'después']) {
      const turno = await contexto(respuesta)
      expect(turno.pendingNotice, `"${respuesta}" sí contesta al aviso`).toBeTruthy()
    }
  })

  test('sin mensaje no se entrega el aviso: la conducta segura es la de antes', async () => {
    await despachar()
    const turno = await (await POST_contexto(peticionAgente('http://localhost/api/agent/context', { businessId: NEGOCIO, phone: TELEFONO }))).json()
    expect(turno.pendingNotice).toBeNull()
  })
})

test.describe('Las reglas del agente para responder a un aviso', () => {
  const workflow = () => require('../../n8n-workflows/01-agen-agent.json') as { nodes: Array<{ name: string; parameters: any }> }
  const nodoAgente = () => workflow().nodes.find((nodo) => nodo.name === 'Agente Agen')!

  test('el contexto del prompt inyecta AVISO_PENDIENTE', () => {
    expect(nodoAgente().parameters.text).toContain('AVISO_PENDIENTE')
    expect(nodoAgente().parameters.text).toContain('pendingNotice')
  })

  test('el workflow le manda el mensaje del cliente al contexto', () => {
    // Sin el mensaje, la app no puede decidir si el aviso viene al caso y no lo entrega.
    const nodo = workflow().nodes.find((item) => item.name === 'Cargar contexto')!
    expect(nodo.parameters.body).toContain('message')
  })

  test('prohíbe recitarle el aviso al cliente', () => {
    expect(nodoAgente().parameters.options.systemMessage as string).toContain('NUNCA lo leas, lo copies ni se lo repitas')
  })

  test('prohíbe preguntar "¿a qué te refieres?" cuando hay un aviso pendiente', () => {
    const prompt = nodoAgente().parameters.options.systemMessage as string
    expect(prompt).toContain('¿a qué te refieres?')
    expect(prompt).toContain('ifYes')
    expect(prompt).toContain('ifNo')
  })

  test('exige atender las dos partes de una respuesta mixta', () => {
    const prompt = nodoAgente().parameters.options.systemMessage as string
    expect(prompt).toContain('RESPUESTAS MIXTAS')
    expect(prompt).toContain('No, mejor cámbiamela para mañana')
    expect(prompt).toContain('LAS DOS PARTES')
  })
})
