import { test, expect } from '@playwright/test'
import { POST } from '@/app/api/agent/media/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Multimedia del agente: la capacidad es opt-in por negocio.
 *
 * `POST /api/agent/media` lo llama el workflow 01 cuando llega una imagen o una nota de voz.
 * Lo que se fija acá:
 *
 *  1. Si el negocio no encendió `feature_image` / `feature_voice`, **no se llama a OpenAI**:
 *     se devuelve una nota entre paréntesis para que el modelo sepa que llegó algo y no
 *     conteste como si el cliente no hubiera escrito nada.
 *  2. Sin clave de OpenAI (ni del negocio, ni de la plataforma, ni del entorno) la respuesta
 *     es `text: null` — el agente sigue como si el mensaje fuera solo texto, nunca un error.
 *  3. El endpoint exige el secreto compartido igual que el resto de `/api/agent/*`.
 *
 * Ninguna prueba llega a la red: todas cortan antes. Por eso se borra `OPENAI_API_KEY` del
 * entorno en el `beforeEach` — si la máquina de quien ejecuta la tuviera puesta, el caso
 * "sin clave" intentaría una llamada real.
 */

const NEGOCIO = 'negocio-1'
const URL = 'http://localhost/api/agent/media'
const IMAGEN = 'https://ejemplo.invalid/foto.jpg'
const AUDIO = 'https://ejemplo.invalid/nota.ogg'

let falso: SupabaseFalso
let claveDelEntorno: string | undefined

const negocio = (extra: Record<string, unknown> = {}) => ({
  id: NEGOCIO,
  feature_image: false,
  feature_voice: false,
  openai_api_key: null,
  ...extra,
})

const pedir = async (cuerpo: Record<string, unknown>, secreto?: string) => {
  const respuesta = await POST(peticionAgente(URL, cuerpo, 'POST', secreto))
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, unknown> }
}

test.beforeEach(async () => {
  claveDelEntorno = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  falso = await levantarSupabaseFalso({ businesses: [negocio()], platform_settings: [] })
  usarSupabaseFalso(falso)
})

test.afterEach(async () => {
  if (claveDelEntorno === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = claveDelEntorno
  await falso.cerrar()
})

test.describe('Multimedia apagada: el agente se entera, pero no se gasta una llamada', () => {
  test('una imagen con feature_image apagada devuelve la nota, no una descripción', async () => {
    const { estado, cuerpo } = await pedir({ businessId: NEGOCIO, mediaType: 'image', mediaUrl: IMAGEN })
    expect(estado).toBe(200)
    expect(cuerpo.text).toBe('(el cliente envió una imagen, pero esta función está desactivada)')
  })

  test('una nota de voz con feature_voice apagada devuelve la nota', async () => {
    const { cuerpo } = await pedir({ businessId: NEGOCIO, mediaType: 'audio', mediaUrl: AUDIO })
    expect(cuerpo.text).toBe('(el cliente envió una nota de voz, pero esta función está desactivada)')
  })

  test('cada capacidad es independiente: con imagen encendida, el audio sigue apagado', async () => {
    falso.tablas.businesses = [negocio({ feature_image: true })]
    const { cuerpo } = await pedir({ businessId: NEGOCIO, mediaType: 'audio', mediaUrl: AUDIO })
    expect(cuerpo.text).toBe('(el cliente envió una nota de voz, pero esta función está desactivada)')
  })

  test('y al revés: con voz encendida, la imagen sigue apagada', async () => {
    falso.tablas.businesses = [negocio({ feature_voice: true })]
    const { cuerpo } = await pedir({ businessId: NEGOCIO, mediaType: 'image', mediaUrl: IMAGEN })
    expect(cuerpo.text).toBe('(el cliente envió una imagen, pero esta función está desactivada)')
  })
})

test.describe('Sin clave o sin datos, el agente sigue como si fuera solo texto', () => {
  test('con la capacidad encendida pero sin ninguna clave de OpenAI, text es null', async () => {
    falso.tablas.businesses = [negocio({ feature_image: true })]
    const { estado, cuerpo } = await pedir({ businessId: NEGOCIO, mediaType: 'image', mediaUrl: IMAGEN })
    expect(estado).toBe(200)
    expect(cuerpo.text).toBeNull()
  })

  test('sin mediaUrl, sin mediaType o sin negocio, text es null', async () => {
    for (const caso of [
      { businessId: NEGOCIO, mediaType: 'image' },
      { businessId: NEGOCIO, mediaUrl: IMAGEN },
      { mediaType: 'image', mediaUrl: IMAGEN },
      {},
    ]) {
      const { estado, cuerpo } = await pedir(caso)
      expect(estado, JSON.stringify(caso)).toBe(200)
      expect(cuerpo.text, JSON.stringify(caso)).toBeNull()
    }
  })

  test('un negocio que no existe no rompe nada', async () => {
    const { cuerpo } = await pedir({ businessId: 'negocio-fantasma', mediaType: 'image', mediaUrl: IMAGEN })
    expect(cuerpo.text).toBeNull()
  })
})

test.describe('La puerta sigue cerrada sin el secreto compartido', () => {
  test('sin el secreto correcto responde 401 y no mira el negocio', async () => {
    falso.tablas.businesses = [negocio({ feature_image: true, openai_api_key: 'clave-que-no-se-debe-usar' })]
    const { estado, cuerpo } = await pedir({ businessId: NEGOCIO, mediaType: 'image', mediaUrl: IMAGEN }, 'secreto-equivocado')
    expect(estado).toBe(401)
    expect(cuerpo.error).toBe('No autorizado')
    expect(cuerpo.text).toBeUndefined()
  })
})
