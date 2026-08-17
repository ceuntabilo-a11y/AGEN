import { test, expect } from '@playwright/test'
import { POST as TURNO } from '@/app/api/agent/turn/route'
import { POST as ACT } from '@/app/api/agent/act/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Conversaciones reales contra el router de intención.
 *
 * Lo que se prueba no es que el modelo "entienda": es que **el código** decida. Por eso ninguna
 * de estas pruebas llama a OpenAI (se borra la clave del entorno) y todas comprueban lo mismo
 * desde ángulos distintos: que una acción crítica solo ocurre si la base de datos la permite y
 * si el JSON del decisor trae `confirmado: true`.
 *
 * Los seis casos que pidió el encargo están cubiertos: cliente nuevo, cliente con cita,
 * cancelación, reagendamiento, dos clientes peleando el mismo horario y pregunta informativa.
 */

const NEGOCIO = 'neg-1'
const ANA = '56911112222'
const BEA = '56933334444'
const MANANA = new Date(Date.now() + 26 * 3600000)
const RANGO = (inicio: Date, minutos: number) =>
  `[${inicio.toISOString()},${new Date(inicio.getTime() + minutos * 60000).toISOString()})`

let falso: SupabaseFalso
let claveOpenAi: string | undefined

const datos = (extra: Tablas = {}): Tablas => ({
  businesses: [{
    id: NEGOCIO, active: true, name: 'Bella Vida', timezone: 'America/Santiago', currency: 'CLP',
    address: 'Av. Providencia 1234', phone: '+56941398290', maps_url: null,
    settings: {}, agent_settings: {}, openai_api_key: null,
    feature_image: false, feature_voice: false,
    whatsapp_provider: 'EVOLUTION', whatsapp_instance: 'Agen',
  }],
  specialties: [{ id: 'esp-1', business_id: NEGOCIO, active: true, name: 'Manicura', slug: 'manicura', description: null, color: null }],
  services: [{ id: 'srv-1', business_id: NEGOCIO, active: true, name: 'Manicura Semipermanente', description: null, duration_minutes: 50, price: 14000, deposit_amount: 0, buffer_before_minutes: 0 }],
  professionals: [{ id: 'pro-1', business_id: NEGOCIO, active: true, display_name: 'Camila Rojas', phone: null, member_id: null }],
  branches: [],
  business_members: [],
  clients: [{ id: 'cli-ana', business_id: NEGOCIO, phone: ANA, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
  appointments: [],
  appointment_holds: [],
  conversations: [],
  messages: [],
  waitlist_entries: [],
  follow_up_tasks: [],
  platform_settings: [],
  outbound_prompts: [],
  portfolio_items: [],
  ...extra,
})

const apartado = (id: string, contacto: string, inicio: Date) => ({
  id, business_id: NEGOCIO, client_id: null, contact_key: contacto,
  service_id: 'srv-1', professional_id: 'pro-1',
  period: RANGO(inicio, 50), expires_at: new Date(Date.now() + 9 * 60000).toISOString(),
  service: { name: 'Manicura Semipermanente' }, professional: { display_name: 'Camila Rojas' },
})

const reserva = (id: string, clientId: string, inicio: Date, estado = 'PENDING') => ({
  id, business_id: NEGOCIO, client_id: clientId, status: estado, client_confirmed_at: null,
  service_period: RANGO(inicio, 50), period: RANGO(inicio, 50),
  service_id: 'srv-1', professional_id: 'pro-1',
  service: { name: 'Manicura Semipermanente' }, professional: { display_name: 'Camila Rojas' },
})

/** Las funciones SQL, simuladas con la misma conducta que importa acá. */
function simularSql() {
  falso.respuestasRpc.confirm_held_appointment = (argumentos, tablas) => {
    const hold = (tablas.appointment_holds ?? []).find((item) => item.id === argumentos.p_hold_id)
    if (!hold) throw Object.assign(new Error('Ese horario acaba de ocuparse'), { code: '23P01' })
    tablas.appointment_holds = (tablas.appointment_holds ?? []).filter((item) => item.id !== hold.id)
    const fila = {
      id: `cita-${hold.id}`, business_id: NEGOCIO, client_id: argumentos.p_client_id, status: 'PENDING',
      client_confirmed_at: null, service_period: hold.period, period: hold.period,
      service_id: hold.service_id, professional_id: hold.professional_id,
      service: { name: 'Manicura Semipermanente' }, professional: { display_name: 'Camila Rojas' },
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    tablas.appointments = [...(tablas.appointments ?? []), fila]
    return fila
  }
  falso.respuestasRpc.cancel_safe_appointment = (argumentos, tablas) => {
    const fila = (tablas.appointments ?? []).find((item) => item.id === argumentos.p_appointment_id)
    if (!fila) throw Object.assign(new Error('Reserva inexistente'), { code: 'P0002' })
    fila.status = 'CANCELLED'
    return fila
  }
  falso.respuestasRpc.confirm_appointment_by_client = (argumentos, tablas) => {
    const fila = (tablas.appointments ?? []).find((item) => item.id === argumentos.p_appointment_id)
    if (!fila) throw Object.assign(new Error('Reserva inexistente'), { code: 'P0002' })
    fila.status = 'CONFIRMED'
    fila.client_confirmed_at = new Date().toISOString()
    return fila
  }
  falso.respuestasRpc.reschedule_safe_appointment = (argumentos, tablas) => {
    const fila = (tablas.appointments ?? []).find((item) => item.id === argumentos.p_appointment_id)
    if (!fila) throw Object.assign(new Error('Reserva inexistente'), { code: 'P0002' })
    fila.service_period = RANGO(new Date(argumentos.p_new_start), 50)
    return fila
  }
  falso.respuestasRpc.create_slot_hold = () => null
}

const turno = async (cuerpo: Record<string, unknown>) => {
  const respuesta = await TURNO(peticionAgente('http://localhost/api/agent/turn', cuerpo))
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, any> }
}

const actuar = async (phone: string, decision: Record<string, unknown> | string) => {
  const respuesta = await ACT(peticionAgente('http://localhost/api/agent/act', { businessId: NEGOCIO, phone, decision }))
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, any> }
}

test.beforeEach(async () => {
  claveOpenAi = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  falso = await levantarSupabaseFalso(datos())
  simularSql()
  usarSupabaseFalso(falso)
})

test.afterEach(async () => {
  if (claveOpenAi === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = claveOpenAi
  await falso.cerrar()
})

/* ────────────────────────── 1. Cliente nuevo ────────────────────────── */

test.describe('Cliente nuevo', () => {
  test('quien escribe por primera vez pidiendo hora va a la rama que solo BUSCA', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: BEA, message: 'hola, quiero una hora para manicura' })
    expect(cuerpo.ruta).toBe('BUSCAR')
    // La rama de búsqueda tiene prohibido dar nada por reservado.
    expect(cuerpo.systemMessage).toContain('NO puedes reservar')
  })

  test('se le pide UN dato y no un formulario', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: BEA, message: 'quiero hora para manicura' })
    const peticiones = ['A nombre de quién', 'tu correo', 'fecha de nacimiento'].filter((texto) => cuerpo.systemMessage.includes(texto))
    expect(peticiones).toHaveLength(1)
  })

  test('un saludo suelto se contesta sin gastar el modelo', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: BEA, message: 'hola' })
    expect(cuerpo.ruta).toBe('DIRECTA')
    expect(cuerpo.texto).toContain('Bella Vida')
  })
})

/* ──────────────────── 2. Cliente con cita existente ──────────────────── */

test.describe('Cliente con una cita vigente', () => {
  test.beforeEach(() => {
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana', MANANA)]
  })

  test('"no puedo ir" lleva a la rama que DECIDE, no a una respuesta inventada', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: 'no puedo ir mañana' })
    expect(cuerpo.ruta).toBe('DECIDIR')
    expect(cuerpo.intencion).toBe('CANCELAR')
    expect(cuerpo.userMessage).toContain('RESERVAS')
  })

  test('el contexto se carga SIEMPRE antes de decidir nada (requisito 3)', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: 'quiero cambiar mi hora' })
    expect(cuerpo.diagnostico.reservas).toBe(1)
  })
})

/* ───────────────────────── 3. Cancelación ───────────────────────── */

test.describe('Cancelar', () => {
  test.beforeEach(() => {
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana', MANANA)]
  })

  test('sin confirmado:true NO se cancela nada', async () => {
    const { cuerpo } = await actuar(ANA, { intencion: 'CANCELAR', appointmentId: 'cita-1', confirmado: false, mensaje: '¿Confirmo que la cancelo?' })
    expect(cuerpo.ejecutado).toBe(false)
    expect(cuerpo.text).toBe('¿Confirmo que la cancelo?')
    expect(falso.rpc.filter((item) => item.nombre === 'cancel_safe_appointment')).toHaveLength(0)
    expect(falso.tablas.appointments[0].status).toBe('PENDING')
  })

  test('con confirmado:true se cancela y el texto sale de la base, no del chat', async () => {
    const { cuerpo } = await actuar(ANA, { intencion: 'CANCELAR', appointmentId: 'cita-1', confirmado: true, reason: 'me enfermé' })
    expect(cuerpo.ejecutado).toBe(true)
    expect(falso.tablas.appointments[0].status).toBe('CANCELLED')
    expect(cuerpo.text).toContain('cancelé tu hora')
    expect(cuerpo.text).toContain('¿Quieres que te busque otro horario?')
  })

  test('nadie puede cancelar la hora de otra persona', async () => {
    falso.tablas.clients = [...falso.tablas.clients, { id: 'cli-bea', business_id: NEGOCIO, phone: BEA, full_name: 'Bea Soto', email: null, birthday: null, marketing_opt_in: false }]
    const { cuerpo } = await actuar(BEA, { intencion: 'CANCELAR', appointmentId: 'cita-1', confirmado: true })
    expect(cuerpo.ejecutado).toBeFalsy()
    expect(falso.tablas.appointments[0].status).toBe('PENDING')
  })

  test('sin reservas vigentes ni siquiera se llega al modelo', async () => {
    falso.tablas.appointments = []
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: 'cancela mi hora por favor' })
    expect(cuerpo.ruta).toBe('DIRECTA')
    expect(cuerpo.texto).toContain('No encuentro ninguna hora reservada')
    expect(falso.rpc).toHaveLength(0)
  })
})

/* ───────────────────────── 4. Reagendamiento ───────────────────────── */

test.describe('Reagendar', () => {
  test('mover usa el apartado nuevo y conserva la reserva (no la libera antes)', async () => {
    const nueva = new Date(Date.now() + 50 * 3600000)
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana', MANANA)]
    falso.tablas.appointment_holds = [apartado('hold-1', ANA, nueva)]

    const { cuerpo } = await actuar(ANA, { intencion: 'MOVER', appointmentId: 'cita-1', holdId: 'hold-1', confirmado: true, reason: 'me sale un imprevisto' })
    expect(cuerpo.ejecutado).toBe(true)
    expect(cuerpo.accion).toBe('MOVER')
    expect(falso.tablas.appointments).toHaveLength(1)
    expect(falso.tablas.appointments[0].status).toBe('PENDING')
    expect(falso.rpc.some((item) => item.nombre === 'cancel_safe_appointment')).toBe(false)
    // El apartado se suelta antes de mover: si no, bloquearía su propio horario.
    expect(falso.tablas.appointment_holds).toHaveLength(0)
  })

  test('un apartado vencido no reserva ni mueve nada', async () => {
    falso.tablas.appointment_holds = [{ ...apartado('hold-viejo', ANA, MANANA), expires_at: new Date(Date.now() - 60000).toISOString() }]
    const { cuerpo } = await actuar(ANA, { intencion: 'RESERVAR', holdId: 'hold-viejo', confirmado: true })
    expect(cuerpo.ejecutado).toBeFalsy()
    expect(cuerpo.text).toContain('acaba de tomarlo otra persona')
    expect(falso.tablas.appointments).toHaveLength(0)
  })
})

/* ────────────── 5. Dos clientes pidiendo el mismo horario ────────────── */

test.describe('Dos clientes, un solo cupo', () => {
  test('el segundo recibe que se ocupó, y nunca se crean dos reservas', async () => {
    falso.tablas.clients = [...falso.tablas.clients, { id: 'cli-bea', business_id: NEGOCIO, phone: BEA, full_name: 'Bea Soto', email: null, birthday: null, marketing_opt_in: false }]
    falso.tablas.appointment_holds = [apartado('hold-compartido', ANA, MANANA)]

    const primera = await actuar(ANA, { intencion: 'RESERVAR', holdId: 'hold-compartido', confirmado: true })
    const segunda = await actuar(BEA, { intencion: 'RESERVAR', holdId: 'hold-compartido', confirmado: true })

    expect(primera.cuerpo.ejecutado).toBe(true)
    expect(segunda.cuerpo.ejecutado).toBeFalsy()
    expect(segunda.cuerpo.text).toContain('acaba de tomarlo otra persona')
    expect(falso.tablas.appointments).toHaveLength(1)
  })

  test('la reserva confirmada se le anuncia al cliente con el día y la hora guardados', async () => {
    falso.tablas.appointment_holds = [apartado('hold-1', ANA, MANANA)]
    const { cuerpo } = await actuar(ANA, { intencion: 'RESERVAR', holdId: 'hold-1', confirmado: true })
    expect(cuerpo.text).toContain('quedó reservada')
    expect(cuerpo.text).toMatch(/\d{2}:\d{2}/)
    expect(cuerpo.text).toContain('Manicura Semipermanente')
  })
})

/* ──────────────────── 6. Pregunta informativa ──────────────────── */

test.describe('Pregunta informativa', () => {
  test('preguntar precios va a la rama SIN herramientas', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: '¿cuánto cuesta la manicura?' })
    expect(cuerpo.ruta).toBe('INFO')
    expect(cuerpo.systemMessage).toContain('NO tienes ninguna herramienta')
    expect(cuerpo.systemMessage).toContain('Nunca inventes servicios')
    // El catálogo del turno es el del negocio y solo el del negocio.
    expect(cuerpo.userMessage).toContain('Manicura Semipermanente')
  })

  test('el catálogo nunca trae servicios de otro negocio (requisito 6)', async () => {
    falso.tablas.services = [
      ...falso.tablas.services,
      { id: 'srv-ajeno', business_id: 'otro-negocio', active: true, name: 'Servicio de Otro Negocio', duration_minutes: 30, price: 1, description: null, deposit_amount: 0 },
    ]
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: '¿qué servicios tienen?' })
    expect(cuerpo.userMessage).not.toContain('Servicio de Otro Negocio')
  })
})

/* ──────────────────── Datos, correo y cumpleaños ──────────────────── */

test.describe('Datos del cliente', () => {
  test('un correo escrito en el mensaje se guarda solo, sin preguntarle al modelo', async () => {
    await turno({ businessId: NEGOCIO, phone: ANA, message: 'mi correo es Ana.Perez@Ejemplo.CL, gracias' })
    expect(falso.tablas.clients.find((item) => item.id === 'cli-ana')?.email).toBe('ana.perez@ejemplo.cl')
  })

  test('una fecha de nacimiento escrita en el mensaje se guarda sola', async () => {
    await turno({ businessId: NEGOCIO, phone: ANA, message: 'nací el 12/03/1990' })
    expect(falso.tablas.clients.find((item) => item.id === 'cli-ana')?.birthday).toBe('1990-03-12')
  })

  test('el correo se pide siempre explicando para qué (requisito 14)', async () => {
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: '¿tienen hora el jueves?' })
    expect(cuerpo.systemMessage).toContain('avisarte de tu hora')
  })

  test('si hoy es su cumpleaños, el saludo va primero (requisito 15)', async () => {
    const hoy = new Date()
    const cumple = `1990-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
    falso.tablas.clients = [{ ...falso.tablas.clients[0], birthday: cumple }]
    const { cuerpo } = await turno({ businessId: NEGOCIO, phone: ANA, message: 'hola' })
    expect(cuerpo.texto.startsWith('¡Feliz cumpleaños')).toBe(true)
  })
})

/* ──────────────────── El JSON del decisor no manda ──────────────────── */

test.describe('El JSON del decisor se valida, no se obedece', () => {
  test('un JSON ilegible no ejecuta nada', async () => {
    const { cuerpo } = await actuar(ANA, 'esto no es json')
    expect(cuerpo.ejecutado).toBe(false)
    expect(cuerpo.motivo).toBe('DECISION_ILEGIBLE')
    expect(falso.rpc).toHaveLength(0)
  })

  test('un JSON envuelto en vallas de código sí se entiende', async () => {
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana', MANANA)]
    const { cuerpo } = await actuar(ANA, '```json\n{"intencion":"CANCELAR","appointmentId":"cita-1","confirmado":true}\n```')
    expect(cuerpo.ejecutado).toBe(true)
  })

  test('un appointmentId inventado no cancela "la más próxima"', async () => {
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana', MANANA), reserva('cita-2', 'cli-ana', new Date(Date.now() + 80 * 3600000))]
    const { cuerpo } = await actuar(ANA, { intencion: 'CANCELAR', appointmentId: 'cita-inventada', confirmado: true })
    expect(cuerpo.ejecutado).toBeFalsy()
    expect(cuerpo.motivo).toBe('VARIAS_RESERVAS')
    expect(falso.tablas.appointments.every((item) => item.status === 'PENDING')).toBe(true)
  })

  test('una intención desconocida no ejecuta nada', async () => {
    const { cuerpo } = await actuar(ANA, { intencion: 'BORRAR_TODO', confirmado: true })
    expect(cuerpo.ejecutado).toBe(false)
    expect(falso.rpc).toHaveLength(0)
  })
})
