import { test, expect } from '@playwright/test'
import { POST as TURNO } from '@/app/api/agent/turn/route'
import { comentarioDelMensaje, correspondePedirResena, esEnlaceDeResena, notaDelMensaje, textoDeAgradecimiento } from '@/lib/agent-encuesta'
import { pareceRespuestaAlAviso } from '@/lib/outbound-context'
import { buildNotification } from '@/lib/notification-templates'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * La encuesta de satisfacción, de punta a punta.
 *
 * Tres cosas estaban rotas a la vez y ninguna se veía por separado:
 *
 * 1. El mensaje pedía «una nota del 1 al 5», la tabla `survey_responses` acepta de 0 a 10 y el
 *    filtro que decide si un mensaje contesta a un aviso solo reconocía del 1 al 5. Un cliente
 *    que respondía «9» no pasaba el filtro, así que al agente ni siquiera se le entregaba el
 *    aviso: contestaba como si nadie le hubiera preguntado nada.
 * 2. Nada guardaba la nota. La columna `source = 'AI_AGENT'` existía desde el primer día y no
 *    la escribía ningún código.
 * 3. `REVIEW_REQUEST` no lo encolaba ninguna función: la encuesta automática no existía.
 *
 * Acá se fija lo que impide que vuelva a pasar. La nota la reconoce y la guarda el CÓDIGO: es
 * un número, no hay nada que interpretar.
 */

const NEGOCIO = 'neg-1'
const ANA = '56911112222'

let falso: SupabaseFalso
let claveOpenAi: string | undefined

const datos = (extra: Tablas = {}): Tablas => ({
  businesses: [{
    id: NEGOCIO, active: true, name: 'Bella Vida', timezone: 'America/Santiago', currency: 'CLP',
    address: null, phone: null, maps_url: null, settings: {}, agent_settings: {},
    openai_api_key: null, feature_image: false, feature_voice: false,
  }],
  specialties: [], services: [], professionals: [], branches: [], business_members: [],
  clients: [{ id: 'cli-ana', business_id: NEGOCIO, phone: ANA, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
  appointments: [], appointment_holds: [], conversations: [], messages: [],
  waitlist_entries: [], follow_up_tasks: [], platform_settings: [], survey_responses: [],
  outbound_prompts: [{
    id: 'aviso-1', business_id: NEGOCIO, client_id: 'cli-ana', kind: 'REVIEW_REQUEST',
    expects: 'RATING', question: 'Le pedimos que califique su visita del 1 al 10.',
    if_yes: null, if_no: null, summary: null, appointment_id: null, campaign_id: null,
    answered_at: null, sent_at: new Date(Date.now() - 3600000).toISOString(),
    expires_at: new Date(Date.now() + 72 * 3600000).toISOString(),
  }],
  agent_inbox: [],
  ...extra,
})

const turno = async (message: string) => {
  const respuesta = await TURNO(peticionAgente('http://localhost/api/agent/turn', { businessId: NEGOCIO, phone: ANA, message }))
  return await respuesta.json() as Record<string, any>
}

test.beforeEach(async () => {
  claveOpenAi = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  falso = await levantarSupabaseFalso(datos())
  usarSupabaseFalso(falso)
})

test.afterEach(async () => {
  if (claveOpenAi === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = claveOpenAi
  await falso.cerrar()
})

test.describe('Reconocer la nota', () => {
  for (const [mensaje, esperada] of [
    ['9', 9], ['10', 10], ['0', 0], ['un 8', 8],
    ['9/10', 9], ['9 de 10', 9], ['le doy un 7', 7],
    ['8 porque la atención fue muy buena', 8],
  ] as Array<[string, number]>) {
    test(`"${mensaje}" es un ${esperada}`, () => {
      expect(notaDelMensaje(mensaje)).toBe(esperada)
    })
  }

  for (const mensaje of ['a las 9:30', 'nos vemos el 18', 'hola', '', 'quiero hora', '10 minutos tarde', '2 personas']) {
    test(`"${mensaje}" NO es una nota`, () => {
      expect(notaDelMensaje(mensaje)).toBeNull()
    })
  }

  test('el comentario se guarda aparte del número', () => {
    expect(comentarioDelMensaje('8 porque la atención fue muy buena')).toContain('atención')
    expect(comentarioDelMensaje('9')).toBeNull()
  })
})

test.describe('La escala dice lo mismo en los tres sitios', () => {
  test('el mensaje que se le manda al cliente pide del 1 al 10', () => {
    const aviso = buildNotification('REVIEW_REQUEST', {
      business: { name: 'Bella Vida', timezone: 'America/Santiago' },
      clientName: 'Ana',
    })
    expect(aviso?.text).toContain('1 al 10')
    expect(aviso?.espera.expects).toBe('RATING')
  })

  test('un "9" cuenta como respuesta a un aviso (antes solo del 1 al 5)', () => {
    for (const nota of ['0', '6', '9', '10', '9/10']) {
      expect(pareceRespuestaAlAviso(nota), nota).toBe(true)
    }
  })
})

test.describe('La nota se guarda sola, sin modelo', () => {
  test('responder "9" a la encuesta la guarda y agradece', async () => {
    const cuerpo = await turno('9')
    expect(cuerpo.ruta).toBe('DIRECTA')
    expect(cuerpo.intencion).toBe('ENCUESTA')
    expect(cuerpo.texto).toContain('9')

    const guardadas = falso.tablas.survey_responses ?? []
    expect(guardadas).toHaveLength(1)
    expect(guardadas[0].score).toBe(9)
    expect(guardadas[0].source).toBe('AI_AGENT')
    expect(guardadas[0].business_id).toBe(NEGOCIO)
    expect(guardadas[0].client_id).toBe('cli-ana')
  })

  test('el comentario del cliente viaja con la nota', async () => {
    await turno('7 porque tuve que esperar un rato')
    expect((falso.tablas.survey_responses ?? [])[0].comment).toContain('esperar')
  })

  test('una nota baja no se contesta con una celebración', async () => {
    const cuerpo = await turno('3')
    expect(cuerpo.texto).toContain('equipo')
    expect(cuerpo.texto).not.toContain('🙌')
  })

  test('sin encuesta pendiente, un "9" no inventa ninguna nota', async () => {
    falso.tablas.outbound_prompts = []
    await turno('9')
    expect(falso.tablas.survey_responses ?? []).toHaveLength(0)
  })

  test('si la tabla de encuestas no existe, el cliente igual recibe respuesta', async () => {
    falso.tablas.survey_responses = undefined as unknown as Record<string, unknown>[]
    const cuerpo = await turno('9')
    expect(cuerpo.texto).toBeTruthy()
  })

  test('el agradecimiento lo escribe el código, no el modelo', () => {
    expect(textoDeAgradecimiento(10)).toContain('10')
    expect(textoDeAgradecimiento(2)).toContain('equipo')
  })
})

/*
 * La reseña en Google es la regla clásica de NPS: solo a los promotores. Pedírsela a quien puso
 * un 6 es pedirle que publique un 6, y esa reseña queda para siempre.
 */
test.describe('La reseña en Google solo a quien puso 9 o 10', () => {
  const ENLACE = 'https://g.page/r/CTuNegocioDeEjemplo/review'

  const conEnlace = () => {
    falso.tablas.businesses = [{ ...falso.tablas.businesses[0], settings: { google_review_url: ENLACE } }]
  }

  for (const nota of [9, 10]) {
    test(`con un ${nota} se le manda el enlace`, async () => {
      conEnlace()
      const cuerpo = await turno(String(nota))
      expect(cuerpo.texto).toContain(ENLACE)
      expect(cuerpo.texto.toLowerCase()).toContain('reseña')
    })
  }

  for (const nota of [0, 5, 7, 8]) {
    test(`con un ${nota} NO se le manda`, async () => {
      conEnlace()
      const cuerpo = await turno(String(nota))
      expect(cuerpo.texto).not.toContain(ENLACE)
      expect(cuerpo.texto, 'igual hay que agradecerle').toBeTruthy()
    })
  }

  test('sin enlace configurado, se agradece y no se promete nada', async () => {
    const cuerpo = await turno('10')
    expect(cuerpo.texto).toContain('10')
    expect(cuerpo.texto.toLowerCase()).not.toContain('reseña')
    expect(cuerpo.texto).not.toContain('http')
  })

  test('un enlace mal escrito no se manda nunca', () => {
    for (const malo of ['google.com/reviews', 'javascript:alert(1)', '', null, undefined, '   ']) {
      expect(esEnlaceDeResena(malo), String(malo)).toBe(false)
      expect(textoDeAgradecimiento(10, malo as string | null)).not.toContain('reseña')
    }
    expect(esEnlaceDeResena(ENLACE)).toBe(true)
  })

  test('la nota se guarda igual, se pida o no la reseña', async () => {
    conEnlace()
    await turno('10')
    expect((falso.tablas.survey_responses ?? [])[0].score).toBe(10)
  })

  test('correspondePedirResena resume la regla en un sitio', () => {
    expect(correspondePedirResena(9, ENLACE)).toBe(true)
    expect(correspondePedirResena(10, ENLACE)).toBe(true)
    expect(correspondePedirResena(8, ENLACE)).toBe(false)
    expect(correspondePedirResena(10, null)).toBe(false)
  })
})
