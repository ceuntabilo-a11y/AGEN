import { test, expect } from '@playwright/test'
import { POST } from '@/app/api/agent/escalate/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Escalación a una persona: que ocurra de verdad.
 *
 * El bug observado en una conversación real: el agente ofrecía "¿quieres que avise al equipo?"
 * y, dijera el cliente lo que dijera, **no pasaba nada**. No existía herramienta, ni endpoint,
 * ni fila en ninguna tabla. El cliente quedaba esperando una llamada que nadie sabía que tenía
 * que hacer, y el negocio ni se enteraba de que había una queja.
 *
 * Lo que estas pruebas fijan: que escalar deje rastro persistente en los tres sitios que lo
 * hacen accionable —estado del hilo, mensaje de sistema y aviso al equipo—, que insistir no
 * duplique avisos, y sobre todo que **nunca se responda "avisado" si no se avisó a nadie**.
 */

const NEGOCIO = 'negocio-1'
const TELEFONO = '56911112222'
const DUENO = 'usuario-dueno'
const RECEPCION = 'usuario-recepcion'
const PROFESIONAL = 'usuario-profesional'

let falso: SupabaseFalso

const datos = (extra: Tablas = {}): Tablas => ({
  businesses: [{ id: NEGOCIO, active: true, name: 'Bella Vida', phone: '+56222222222' }],
  // Los teléfonos se guardan normalizados a solo dígitos (ver `normalizePhone`).
  clients: [{ id: 'cliente-1', business_id: NEGOCIO, phone: TELEFONO, full_name: 'Ana Pérez' }],
  business_members: [
    { id: 'm1', business_id: NEGOCIO, user_id: DUENO, role: 'OWNER', active: true },
    { id: 'm2', business_id: NEGOCIO, user_id: RECEPCION, role: 'RECEPTIONIST', active: true },
    { id: 'm3', business_id: NEGOCIO, user_id: PROFESIONAL, role: 'PROFESSIONAL', active: true },
  ],
  professionals: [],
  conversations: [],
  messages: [],
  team_notifications: [],
  ...extra,
})

const escalar = (cuerpo: Record<string, unknown>) =>
  POST(peticionAgente('http://localhost/api/agent/escalate', cuerpo))

const cuerpoValido = {
  businessId: NEGOCIO,
  phone: TELEFONO,
  reason: 'QUEJA',
  message: 'Llegué y no había nadie atendiendo, quiero hablar con alguien.',
}

const avisos = () => falso.tablas.team_notifications ?? []
const hilos = () => falso.tablas.conversations ?? []
const mensajes = () => falso.tablas.messages ?? []

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso(datos())
  usarSupabaseFalso(falso)
})

test.afterEach(async () => { await falso.cerrar() })

test.describe('Escalar deja rastro real, no una frase', () => {
  test('el hilo pasa a HUMAN, queda un mensaje de sistema y se avisa al equipo', async () => {
    const respuesta = await escalar(cuerpoValido)
    const cuerpo = await respuesta.json()

    expect(respuesta.status).toBe(200)
    expect(cuerpo.escalated).toBe(true)
    expect(cuerpo.notified).toBe(2)

    expect(hilos()).toHaveLength(1)
    expect(hilos()[0].status).toBe('HUMAN')

    const sistema = mensajes().filter((item) => item.sender === 'SYSTEM')
    expect(sistema).toHaveLength(1)
    expect(sistema[0].content).toContain('QUEJA')
    expect(sistema[0].content).toContain('no había nadie atendiendo')
  })

  test('avisa a quien atiende recepción, no a los profesionales', async () => {
    await escalar(cuerpoValido)
    // Un PROFESSIONAL atiende su agenda; una queja o un pago no es su mesa.
    expect(avisos().map((item) => item.recipient_user_id).sort()).toEqual([DUENO, RECEPCION].sort())
    expect(avisos().every((item) => item.kind === 'ESCALATION')).toBe(true)
  })

  test('el aviso identifica a quién hay que contestar y por qué', async () => {
    await escalar(cuerpoValido)
    const aviso = avisos()[0]
    expect(aviso.title).toContain('Reclamo')
    expect(aviso.body).toContain('Ana Pérez')
    expect(aviso.body).toContain(TELEFONO)
    expect(aviso.payload.conversationId).toBe(hilos()[0].id)
  })

  test('un teléfono sin ficha también se puede escalar', async () => {
    falso.tablas.clients = []
    const cuerpo = await (await escalar(cuerpoValido)).json()
    expect(cuerpo.escalated).toBe(true)
    expect(avisos()[0].body).toContain(TELEFONO)
    expect(hilos()[0].client_id).toBeNull()
  })
})

test.describe('Insistir no multiplica avisos', () => {
  test('tres llamadas del mismo motivo dejan un aviso por persona', async () => {
    await escalar(cuerpoValido)
    await escalar(cuerpoValido)
    const tercera = await (await escalar(cuerpoValido)).json()

    expect(avisos()).toHaveLength(2)
    expect(tercera.escalated).toBe(true)
    // `alreadyDone` es la señal que usa el prompt para no repetirle al cliente la misma frase.
    expect(tercera.alreadyDone).toBe(true)
    expect(mensajes().filter((item) => item.sender === 'SYSTEM')).toHaveLength(1)
  })
})

test.describe('Nunca se dice "avisado" si no se avisó', () => {
  test('sin nadie del equipo con cuenta, responde escalated:false y el teléfono del negocio', async () => {
    falso.tablas.business_members = [
      { id: 'm3', business_id: NEGOCIO, user_id: PROFESIONAL, role: 'PROFESSIONAL', active: true },
    ]
    const cuerpo = await (await escalar(cuerpoValido)).json()

    expect(cuerpo.escalated).toBe(false)
    expect(cuerpo.reason).toBe('sin_equipo')
    expect(cuerpo.businessPhone).toBe('+56222222222')
    // El hilo igual queda marcado: se ve en el panel aunque no haya a quién notificar.
    expect(hilos()[0].status).toBe('HUMAN')
    expect(avisos()).toHaveLength(0)
  })
})

test.describe('Puerta de entrada', () => {
  test('sin el secreto compartido no se escala nada', async () => {
    const respuesta = await POST(new Request('http://localhost/api/agent/escalate', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpoValido),
    }))
    expect(respuesta.status).toBe(401)
    expect(hilos()).toHaveLength(0)
  })

  test('un identificador que no es un teléfono (grupo de WhatsApp) se rechaza', async () => {
    const respuesta = await escalar({ ...cuerpoValido, phone: '120363111222333444' })
    expect(respuesta.status).toBe(400)
    expect(hilos()).toHaveLength(0)
  })

  test('un motivo inventado por el modelo se rechaza y dice cuáles valen', async () => {
    const respuesta = await escalar({ ...cuerpoValido, reason: 'URGENTE_SUPER_IMPORTANTE' })
    expect(respuesta.status).toBe(400)
    expect((await respuesta.json()).error).toContain('QUEJA')
    expect(avisos()).toHaveLength(0)
  })

  test('sin detalle no se escala: un aviso vacío no es accionable', async () => {
    const respuesta = await escalar({ ...cuerpoValido, message: '   ' })
    expect(respuesta.status).toBe(400)
    expect(avisos()).toHaveLength(0)
  })

  test('un negocio inexistente no crea hilos huérfanos', async () => {
    const respuesta = await escalar({ ...cuerpoValido, businessId: 'negocio-que-no-existe' })
    expect(respuesta.status).toBe(404)
    expect(hilos()).toHaveLength(0)
  })
})
