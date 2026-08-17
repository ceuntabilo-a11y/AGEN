import { test, expect } from '@playwright/test'
import { POST as TURNO } from '@/app/api/agent/turn/route'
import { POST as ACT } from '@/app/api/agent/act/route'
import { POST as INBOX, PUT as AGRUPAR } from '@/app/api/agent/inbox/route'
import { franjaDelMensaje, horaDelMensaje, interpretarCuando, pideOtroHorario } from '@/lib/agent-tiempo'
import { referenciasTemporales } from '@/lib/timezone'
import { buildNotification } from '@/lib/notification-templates'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Conversaciones como las escribe una persona de verdad.
 *
 * Esta batería nace de una queja concreta del dueño: «cada vez que pruebo a mano encuentro
 * fallas nuevas que las pruebas automáticas no detectaron». Tenía razón — las pruebas cubrían
 * el camino feliz y los casos límite del código, no la forma en que la gente escribe.
 *
 * Los tres fallos que se vieron en una sola conversación real (2026-08-17, 16:26–16:35):
 *
 *  1. El cliente dijo «En la tarde», «3pm» y «Para mañana a las 3 de la tarde» y el agente
 *     siguió ofreciéndole las 09:00 y preguntándole a qué se refería.
 *  2. Repitió «Ya te dije para las 3 de la tarde» dos veces y recibió la MISMA pregunta.
 *  3. A tres mensajes de saludo seguidos les contestó tres saludos idénticos.
 *
 * Cada bloque de abajo es una de esas formas de escribir, y todas se resuelven con código:
 * ningún caso depende de que un modelo acierte.
 */

const NEGOCIO = 'neg-1'
const ANA = '56911112222'
const NUEVA = '56955556666'
const ZONA = 'America/Santiago'
const MANANA = new Date(Date.now() + 26 * 3600000)
const RANGO = (inicio: Date, minutos: number) =>
  `[${inicio.toISOString()},${new Date(inicio.getTime() + minutos * 60000).toISOString()})`

let falso: SupabaseFalso
let claveOpenAi: string | undefined

const datos = (extra: Tablas = {}): Tablas => ({
  businesses: [{
    id: NEGOCIO, active: true, name: 'Bella Vida', timezone: ZONA, currency: 'CLP',
    address: 'Av. Providencia 1234', phone: '+56941398290', maps_url: null,
    settings: {}, agent_settings: {}, openai_api_key: null,
    feature_image: false, feature_voice: false,
    whatsapp_provider: 'EVOLUTION', whatsapp_instance: 'Agen',
  }],
  specialties: [{ id: 'esp-1', business_id: NEGOCIO, active: true, name: 'Manos y pies', slug: 'manos', description: null, color: null }],
  services: [
    { id: 'srv-1', business_id: NEGOCIO, active: true, name: 'Pedicura Spa', description: null, duration_minutes: 60, price: 18000, deposit_amount: 0, buffer_before_minutes: 0 },
    { id: 'srv-2', business_id: NEGOCIO, active: true, name: 'Manicura Semipermanente', description: null, duration_minutes: 50, price: 14000, deposit_amount: 0, buffer_before_minutes: 0 },
  ],
  professionals: [{ id: 'pro-1', business_id: NEGOCIO, active: true, display_name: 'Fernanda Muñoz', phone: null, member_id: null }],
  branches: [], business_members: [],
  clients: [{ id: 'cli-ana', business_id: NEGOCIO, phone: ANA, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
  appointments: [], appointment_holds: [], conversations: [], messages: [],
  waitlist_entries: [], follow_up_tasks: [], platform_settings: [], outbound_prompts: [],
  portfolio_items: [], survey_responses: [], agent_inbox: [],
  ...extra,
})

const apartado = (id: string, hora: number) => {
  const inicio = new Date(MANANA)
  inicio.setUTCHours(hora + 4, 0, 0, 0) // 09:00 local = 13:00 UTC en Santiago
  return {
    id, business_id: NEGOCIO, client_id: null, contact_key: ANA,
    service_id: 'srv-1', professional_id: 'pro-1',
    period: RANGO(inicio, 60), expires_at: new Date(Date.now() + 9 * 60000).toISOString(),
    service: { name: 'Pedicura Spa' }, professional: { display_name: 'Fernanda Muñoz' },
  }
}

const reserva = (id: string, clientId: string) => ({
  id, business_id: NEGOCIO, client_id: clientId, status: 'PENDING', client_confirmed_at: null,
  service_period: RANGO(MANANA, 60), period: RANGO(MANANA, 60),
  service_id: 'srv-1', professional_id: 'pro-1',
  service: { name: 'Pedicura Spa' }, professional: { display_name: 'Fernanda Muñoz' },
})

const turno = async (message: string, phone = ANA) => {
  const respuesta = await TURNO(peticionAgente('http://localhost/api/agent/turn', { businessId: NEGOCIO, phone, message }))
  return await respuesta.json() as Record<string, any>
}

const actuar = async (decision: Record<string, unknown> | string, phone = ANA) => {
  const respuesta = await ACT(peticionAgente('http://localhost/api/agent/act', { businessId: NEGOCIO, phone, decision }))
  return await respuesta.json() as Record<string, any>
}

/** Conversación previa, como la lee el turno desde la base. */
const conHistorial = (lineas: Array<{ quien: 'cliente' | 'agen'; texto: string }>) => {
  falso.tablas.conversations = [{ id: 'conv-1', business_id: NEGOCIO, client_id: 'cli-ana', channel: 'WHATSAPP', status: 'OPEN', external_id: ANA, updated_at: new Date().toISOString() }]
  falso.tablas.messages = lineas.map((linea, indice) => ({
    id: `msg-${indice}`, conversation_id: 'conv-1',
    sender: linea.quien === 'cliente' ? 'CLIENT' : 'AI', content: linea.texto,
    created_at: new Date(Date.now() - (lineas.length - indice) * 60000).toISOString(),
  }))
}

test.beforeEach(async () => {
  claveOpenAi = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  falso = await levantarSupabaseFalso(datos())
  falso.respuestasRpc.create_slot_hold = () => null
  usarSupabaseFalso(falso)
})

test.afterEach(async () => {
  if (claveOpenAi === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = claveOpenAi
  await falso.cerrar()
})

/* ═══════════ A1. La misma hora dicha de todas las formas ═══════════ */

test.describe('A1 — la hora, dicha como la dice una persona', () => {
  for (const [mensaje, esperada] of [
    ['3 de la tarde', '15:00'],
    ['3pm', '15:00'],
    ['3 pm', '15:00'],
    ['15:00', '15:00'],
    ['a las 15 hrs', '15:00'],
    ['a las 3', '15:00'],
    ['9 de la mañana', '09:00'],
    ['9am', '09:00'],
    ['a las 10:30', '10:30'],
    ['a las 4 y media', '16:30'],
  ] as Array<[string, string]>) {
    test(`"${mensaje}" son las ${esperada}`, () => {
      expect(horaDelMensaje(mensaje)).toBe(esperada)
    })
  }

  for (const [mensaje, franja] of [
    ['en la tarde', 'tarde'],
    ['por la tarde', 'tarde'],
    ['después del almuerzo', 'tarde'],
    ['en la mañana', 'mañana'],
    ['temprano', 'mañana'],
    ['en la noche', 'noche'],
  ] as Array<[string, string]>) {
    test(`"${mensaje}" es la franja ${franja}`, () => {
      expect(franjaDelMensaje(mensaje)).toBe(franja)
    })
  }

  test('un número que no es una hora no se confunde con una', () => {
    for (const mensaje of ['somos 3 personas', 'llevo 2 años yendo', 'el 18 de agosto']) {
      expect(horaDelMensaje(mensaje), mensaje).toBeNull()
    }
  })

  /*
   * El caso exacto de la conversación real: el día en un mensaje y la hora en otro. El agente
   * perdía uno de los dos y volvía a preguntar.
   */
  test('el día en un mensaje y la hora en el siguiente se juntan', () => {
    const time = referenciasTemporales(new Date(), ZONA)
    const pedido = interpretarCuando('3pm', time, ['En la tarde', 'Para mañana'])
    expect(pedido.dia).toBe('mañana')
    expect(pedido.hora).toBe('15:00')
    expect(pedido.desde).toContain('T15:00')
    expect(pedido.fecha).toBe(time.manana.fecha)
  })

  test('el turno le entrega al modelo la hora ya resuelta, no el texto crudo', async () => {
    conHistorial([{ quien: 'cliente', texto: 'Para mañana' }, { quien: 'cliente', texto: 'En la tarde' }])
    const cuerpo = await turno('3pm')
    expect(cuerpo.userMessage).toContain('PEDIDO')
    expect(cuerpo.userMessage).toContain('"hora":"15:00"')
    expect(cuerpo.systemMessage).toContain('YA dijo cuándo quiere')
  })
})

/* ═══════════ A2. Insistir sin cambiar la redacción ═══════════ */

test.describe('A2 — el cliente insiste y no puede recibir la misma pregunta', () => {
  test('con horarios ofrecidos, pedir OTRA hora manda a buscar, no a elegir', async () => {
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    const cuerpo = await turno('Para mañana a las 3 de la tarde por favor')
    expect(cuerpo.ruta, 'pedir otra hora es una búsqueda nueva').toBe('BUSCAR')
    expect(cuerpo.intencion).toBe('AGENDAR')
  })

  test('e insistir dos veces con lo mismo tampoco lo convierte en una elección', async () => {
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    for (const mensaje of ['Ya te dije para las 3 de la tarde', 'Ya te dije para las 3 de la tarde']) {
      const cuerpo = await turno(mensaje)
      expect(cuerpo.ruta, mensaje).toBe('BUSCAR')
    }
  })

  test('la respuesta anterior se le pasa al modelo con la prohibición de repetirla', async () => {
    conHistorial([
      { quien: 'cliente', texto: 'para las 3' },
      { quien: 'agen', texto: '¿A qué día y horario te refieres exactamente?' },
    ])
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    const cuerpo = await turno('Ya te dije para las 3 de la tarde')
    expect(cuerpo.systemMessage).toContain('PROHIBIDO repetirlo')
    expect(cuerpo.systemMessage).toContain('¿A qué día y horario te refieres exactamente?')
  })

  test('pideOtroHorario distingue elegir de pedir otra cosa', () => {
    const time = referenciasTemporales(new Date(), ZONA)
    const ofrecidos = [{ hora: '09:00' }]
    expect(pideOtroHorario('a las 3 de la tarde', ofrecidos, time)).toBe(true)
    expect(pideOtroHorario('la de las 9', ofrecidos, time)).toBe(false)
    expect(pideOtroHorario('la de Fernanda', ofrecidos, time)).toBe(false)
    expect(pideOtroHorario('dale', ofrecidos, time)).toBe(false)
  })
})

/* ═══════════ A3. Cambiar de opinión ═══════════ */

test.describe('A3 — el cliente cambia de opinión antes de confirmar', () => {
  test('pedir un día distinto después de que le ofrecieron horarios vuelve a buscar', async () => {
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    const cuerpo = await turno('mejor el viernes')
    expect(cuerpo.ruta).toBe('BUSCAR')
  })

  test('y no se reserva nada por el camino', async () => {
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    await turno('mejor el viernes')
    expect(falso.rpc.some((item) => item.nombre === 'confirm_held_appointment')).toBe(false)
  })
})

/* ═══════════ A4. Mensajes ambiguos o incompletos ═══════════ */

test.describe('A4 — mensajes ambiguos', () => {
  test('"preferiblemente" a secas no dispara ninguna acción', async () => {
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    const cuerpo = await turno('Preferiblemente')
    expect(['DECIDIR', 'INFO']).toContain(cuerpo.ruta)
    expect(falso.rpc.some((item) => item.nombre === 'confirm_held_appointment')).toBe(false)
  })

  test('"no sé" y "cualquiera" no reservan por su cuenta', async () => {
    falso.tablas.appointment_holds = [apartado('hold-9', 9)]
    for (const mensaje of ['no sé', 'cualquiera', 'lo que sea']) {
      const cuerpo = await actuar({ intencion: 'RESERVAR', holdId: 'hold-9', confirmado: false, mensaje })
      expect(cuerpo.ejecutado, mensaje).toBe(false)
    }
    expect(falso.tablas.appointments).toHaveLength(0)
  })
})

/* ═══════════ A5. El mismo mensaje duplicado ═══════════ */

test.describe('A5 — webhook duplicado: se contesta UNA vez', () => {
  const pedir = async (handler: (r: Request) => Promise<Response>, cuerpo: Record<string, unknown>) =>
    await (await handler(peticionAgente('http://localhost/api/agent/inbox', cuerpo))).json() as Record<string, any>

  test('el mismo messageId dos veces produce un solo reclamo', async () => {
    const mensaje = { businessId: NEGOCIO, phone: ANA, messageId: 'WA-1', content: 'hola' }
    await pedir(INBOX, mensaje)
    await pedir(INBOX, mensaje)

    const primero = await pedir(AGRUPAR, mensaje)
    const segundo = await pedir(AGRUPAR, mensaje)
    expect(primero.claim).toBe(true)
    expect(segundo.claim, 'el duplicado no puede contestar otra vez').toBe(false)
  })

  test('tres mensajes seguidos se agrupan en una sola respuesta', async () => {
    for (const [id, texto] of [['WA-1', 'Hola'], ['WA-2', 'Buenas tardes'], ['WA-3', 'Hola']] as Array<[string, string]>) {
      await pedir(INBOX, { businessId: NEGOCIO, phone: ANA, messageId: id, content: texto })
    }
    const primeros = await Promise.all([
      pedir(AGRUPAR, { businessId: NEGOCIO, phone: ANA, messageId: 'WA-1' }),
      pedir(AGRUPAR, { businessId: NEGOCIO, phone: ANA, messageId: 'WA-2' }),
    ])
    const ultimo = await pedir(AGRUPAR, { businessId: NEGOCIO, phone: ANA, messageId: 'WA-3' })

    expect(primeros.filter((item) => item.claim), 'solo el último contesta').toHaveLength(0)
    expect(ultimo.claim).toBe(true)
    expect(ultimo.message).toContain('Hola')
    expect(ultimo.message).toContain('Buenas tardes')
  })

  test('la espera de agrupado da tiempo a escribir dos mensajes seguidos', () => {
    const workflow = require('../../n8n-workflows/01-agen-agent.json') as { nodes: Array<Record<string, any>> }
    const espera = workflow.nodes.find((nodo) => nodo.name === 'Esperar')!.parameters
    // Con 0,6 s dos mensajes de una persona entraban como conversaciones distintas y el agente
    // saludaba tres veces seguidas.
    expect(espera.unit).toBe('seconds')
    expect(Number(espera.amount)).toBeGreaterThanOrEqual(2)
  })
})

/* ═══════════ A6. La conversación se retoma ═══════════ */

test.describe('A6 — el cliente vuelve más tarde', () => {
  test('lo que ya dijo sigue en el contexto del turno siguiente', async () => {
    conHistorial([
      { quien: 'cliente', texto: 'quiero hora para pedicura' },
      { quien: 'agen', texto: '¿Para qué día?' },
    ])
    const cuerpo = await turno('mañana en la tarde')
    expect(cuerpo.userMessage).toContain('quiero hora para pedicura')
    expect(cuerpo.userMessage).toContain('"franja":"tarde"')
  })

  test('un apartado vencido no se le ofrece como si siguiera vivo', async () => {
    falso.tablas.appointment_holds = [{ ...apartado('hold-viejo', 9), expires_at: new Date(Date.now() - 60000).toISOString() }]
    const cuerpo = await turno('dale, esa')
    expect(cuerpo.diagnostico?.apartados ?? 0).toBe(0)
  })
})

/* ═══════════ A7. Algo que el negocio no ofrece ═══════════ */

test.describe('A7 — piden algo que no existe', () => {
  /** El catálogo que ve el modelo es el único sitio de donde puede sacar un servicio. */
  const bloqueDeServicios = (contexto: string) => /^SERVICIOS: .*$/m.exec(contexto)?.[0] ?? ''

  test('preguntar por un servicio inexistente va a una rama que no puede inventarlo', async () => {
    const cuerpo = await turno('¿hacen depilación láser?')
    expect(['INFO', 'BUSCAR']).toContain(cuerpo.ruta)
    expect(bloqueDeServicios(cuerpo.userMessage), 'el catálogo no puede nombrar lo que no existe').not.toContain('láser')
    expect(cuerpo.systemMessage).toContain('Nunca inventes servicios')
  })

  test('el catálogo que ve el modelo es exactamente el del negocio', async () => {
    const cuerpo = await turno('¿qué servicios tienen?')
    expect(cuerpo.userMessage).toContain('Pedicura Spa')
    expect(cuerpo.userMessage).toContain('Manicura Semipermanente')
    expect(cuerpo.userMessage).not.toContain('Depilación')
  })
})

/* ═══════════ A8. Errores de tipeo y jerga chilena ═══════════ */

test.describe('A8 — como se escribe de verdad en Chile', () => {
  for (const mensaje of ['ya po, dale', 'ya está bueno', 'dale nomás', 'listo entonces']) {
    test(`"${mensaje}" con horarios ofrecidos es elegir`, async () => {
      falso.tablas.appointment_holds = [apartado('hold-9', 9)]
      const cuerpo = await turno(mensaje)
      expect(cuerpo.ruta).toBe('DECIDIR')
    })
  }

  for (const mensaje of ['kiero cancelar mi ora', 'no voy a poder ir']) {
    test(`"${mensaje}" sin reservas se contesta sin gastar modelo`, async () => {
      const cuerpo = await turno(mensaje)
      expect(cuerpo.texto ?? '').toContain('No encuentro ninguna hora')
    })
  }

  test('los saludos con muletillas siguen entrando por el camino rápido', async () => {
    for (const saludo of ['hola', 'buenas', 'holaa', 'buenas tardes']) {
      const cuerpo = await turno(saludo, NUEVA)
      expect(cuerpo.ruta, saludo).toBe('DIRECTA')
    }
  })
})

/* ═══════════ A9. Dos intenciones en un mensaje ═══════════ */

test.describe('A9 — dos cosas en el mismo mensaje', () => {
  /*
   * «Cancela y agéndame para otro día» se entiende como MOVER, no como cancelar.
   *
   * Es la lectura segura: mover conserva la hora hasta que hay una nueva, mientras que cancelar
   * primero deja al cliente sin nada si después no queda cupo. Lo que NO puede pasar es que se
   * cancele en el turno que solo interpreta.
   */
  test('"cancela y agenda para otro día" no cancela nada en el turno que interpreta', async () => {
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana')]
    const cuerpo = await turno('cancela mi cita y agéndame para otro día')
    expect(cuerpo.ruta, 'mover es más seguro que cancelar y volver a reservar').toBe('BUSCAR')
    expect(cuerpo.intencion).toBe('MOVER')
    expect(falso.rpc.some((item) => item.nombre === 'cancel_safe_appointment'), 'nada se ejecuta acá').toBe(false)
  })

  test('y el ejecutor solo hace la parte confirmada', async () => {
    falso.tablas.appointments = [reserva('cita-1', 'cli-ana')]
    falso.respuestasRpc.cancel_safe_appointment = (argumentos, tablas) => {
      const fila = (tablas.appointments ?? []).find((item) => item.id === argumentos.p_appointment_id)
      if (!fila) throw Object.assign(new Error('no existe'), { code: 'P0002' })
      fila.status = 'CANCELLED'
      return fila
    }
    const cuerpo = await actuar({ intencion: 'CANCELAR', appointmentId: 'cita-1', confirmado: true, reason: 'quiere otro día' })
    expect(cuerpo.ejecutado).toBe(true)
    expect(cuerpo.text).toContain('¿Quieres que te busque otro horario?')
  })
})

/* ═══════════ B2. Memoria y nombre ═══════════ */

test.describe('B2 — el agente sabe con quién habla', () => {
  test('a un cliente registrado lo llama por su nombre', async () => {
    const cuerpo = await turno('¿qué servicios tienen?')
    expect(cuerpo.systemMessage).toContain('se llama Ana')
    expect(cuerpo.systemMessage).toContain('no se lo vuelvas a preguntar')
  })

  test('a uno nuevo le pide el nombre, y solo el nombre', async () => {
    const cuerpo = await turno('quiero una hora', NUEVA)
    expect(cuerpo.systemMessage).toContain('A nombre de quién')
    expect(cuerpo.systemMessage).not.toContain('fecha de nacimiento')
  })

  test('el nombre del perfil de WhatsApp nunca se usa como nombre', async () => {
    const cuerpo = await turno('quiero una hora', NUEVA)
    expect(cuerpo.systemMessage).toContain('nombre del perfil de WhatsApp no es el nombre del cliente')
  })

  test('lo que ya se habló viaja en cada turno', async () => {
    conHistorial([
      { quien: 'cliente', texto: 'quiero pedicura' },
      { quien: 'agen', texto: '¿Para qué día?' },
      { quien: 'cliente', texto: 'para mañana' },
    ])
    const cuerpo = await turno('en la tarde')
    expect(cuerpo.userMessage).toContain('CONVERSACION')
    expect(cuerpo.userMessage).toContain('quiero pedicura')
  })
})

/* ═══════════ D. Lo aprobado antes, ahora comprobado ═══════════ */

test.describe('D1 — captación progresiva completa', () => {
  test('primero el nombre, después el correo, después el nacimiento', async () => {
    const pedido = async (extra: Record<string, unknown>) => {
      falso.tablas.clients = [{ id: 'cli-ana', business_id: NEGOCIO, phone: ANA, full_name: null, email: null, birthday: null, marketing_opt_in: false, ...extra }]
      const cuerpo = await turno('¿tienen hora mañana?')
      return ['A nombre de quién', 'tu correo', 'fecha de nacimiento'].find((texto) => cuerpo.systemMessage.includes(texto))
    }
    expect(await pedido({})).toBe('A nombre de quién')
    expect(await pedido({ full_name: 'Ana Pérez' })).toBe('tu correo')
    expect(await pedido({ full_name: 'Ana Pérez', email: 'ana@ejemplo.cl' })).toBe('fecha de nacimiento')
    expect(await pedido({ full_name: 'Ana Pérez', email: 'ana@ejemplo.cl', birthday: '1990-03-12' })).toBeUndefined()
  })

  test('el correo se pide SIEMPRE con su motivo', async () => {
    falso.tablas.clients = [{ id: 'cli-ana', business_id: NEGOCIO, phone: ANA, full_name: 'Ana Pérez', email: null, birthday: null, marketing_opt_in: false }]
    const cuerpo = await turno('¿tienen hora mañana?')
    expect(cuerpo.systemMessage).toContain('avisarte de tu hora')
    expect(cuerpo.systemMessage).toContain('cancelación')
  })

  test('el correo y el nacimiento se guardan solos cuando los escribe', async () => {
    await turno('mi correo es Ana.Perez@Ejemplo.CL y nací el 12/03/1990')
    const guardada = falso.tablas.clients.find((item) => item.id === 'cli-ana')
    expect(guardada?.email).toBe('ana.perez@ejemplo.cl')
    expect(guardada?.birthday).toBe('1990-03-12')
  })
})

test.describe('D2 — voz e imágenes', () => {
  test('una nota de voz apagada no rompe el turno ni inventa nada', async () => {
    const respuesta = await TURNO(peticionAgente('http://localhost/api/agent/turn', {
      businessId: NEGOCIO, phone: ANA, message: '', mediaType: 'audio', mediaUrl: 'https://ejemplo.invalid/nota.ogg',
    }))
    const cuerpo = await respuesta.json() as Record<string, any>
    expect(respuesta.status).toBe(200)
    expect(cuerpo.wasAudio).toBe(true)
    expect(cuerpo.ruta).toBeTruthy()
  })

  test('una imagen con la función apagada tampoco rompe nada', async () => {
    const respuesta = await TURNO(peticionAgente('http://localhost/api/agent/turn', {
      businessId: NEGOCIO, phone: ANA, message: 'te mando el comprobante', mediaType: 'image', mediaUrl: 'https://ejemplo.invalid/pago.jpg',
    }))
    expect(respuesta.status).toBe(200)
    expect((await respuesta.json()).imageUrl).toBeNull()
  })

  test('sin portafolio publicado no se manda ninguna foto', async () => {
    falso.tablas.portfolio_items = [{ id: 'foto-1', business_id: NEGOCIO, published: false, client_consent: true, after_url: 'https://ejemplo.invalid/uñas.jpg', title: 'Uñas', professional_id: 'pro-1' }]
    const cuerpo = await turno('¿hacen algo así?')
    expect(cuerpo.imageUrl).toBeNull()
  })
})

test.describe('D3 — los recordatorios los decide el negocio', () => {
  test('la migración lee settings.reminders y no una hora fija', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20260818000001_recordatorios_configurables.sql'), 'utf8')
    expect(sql).toContain("v_settings->'reminders'")
    expect(sql).toContain('hoursBefore')
    // El valor por defecto es una sugerencia, no una imposición.
    expect(sql).toContain('"hoursBefore":24')
    expect(sql).toContain('"hoursBefore":2')
  })

  test('el texto del recordatorio ofrece cambiar la hora, no solo cancelar', () => {
    const aviso = buildNotification('REMINDER', {
      business: { name: 'Bella Vida', timezone: ZONA },
      clientName: 'Ana',
      appointment: { start: MANANA.toISOString(), serviceName: 'Pedicura Spa', professionalName: 'Fernanda Muñoz' },
      payload: { hoursBefore: '24' },
    })
    expect(aviso?.text).toContain('te busco otro horario')
    expect(aviso?.espera.ifNo).toContain('buscar_horarios')
  })
})

test.describe('D4 — anti-alucinación', () => {
  test('las tres ramas que hablan tienen prohibido inventar', async () => {
    for (const mensaje of ['¿cuánto cuesta el masaje tailandés?', '¿tienen hora para masaje tailandés?']) {
      const cuerpo = await turno(mensaje)
      expect(cuerpo.systemMessage, mensaje).toContain('Nunca inventes servicios, profesionales, precios, direcciones ni horarios')
      expect(cuerpo.systemMessage, mensaje).toContain('di que no lo tienes')
    }
  })

  test('un servicio que no está en el catálogo no aparece en el catálogo', async () => {
    const cuerpo = await turno('¿cuánto cuesta el masaje tailandés?')
    const servicios = /^SERVICIOS: .*$/m.exec(cuerpo.userMessage)?.[0] ?? ''
    expect(servicios, 'los precios que ve el modelo son los del negocio').toContain('"precio"')
    expect(servicios).not.toContain('tailandés')
    expect(servicios).toContain('Pedicura Spa')
  })

  test('y la rama que habla no puede ejecutar nada', async () => {
    const cuerpo = await turno('¿cuánto cuesta la pedicura?')
    expect(cuerpo.systemMessage).toContain('NO tienes ninguna herramienta')
    expect(falso.rpc).toHaveLength(0)
  })
})
