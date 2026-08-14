import { test, expect } from '@playwright/test'
import { POST } from '@/app/api/agent/voice/reply/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * La voz nunca deja mudo al agente.
 *
 * `POST /api/agent/voice/reply` lo llama el nodo "Responder con voz" de n8n antes de contestar.
 * La garantía de CLAUDE.md §6.1 es que **ningún camino puede devolver "no hables y tampoco
 * escribas"**: si algo falla o la voz está apagada, la respuesta tiene que decir
 * `speak:false, sendText:true` para que n8n mande el texto igual.
 *
 * La segunda garantía es que en modo equipo (`actorType === 'TEAM'`) jamás se responde con voz.
 *
 * Ninguna de estas pruebas llega a DashScope: todas cortan antes, que es justamente lo que se
 * quiere fijar. Con `platform_settings` vacío no hay clave de respaldo, así que el único camino
 * que llegaría a la red queda cerrado por diseño.
 */

const NEGOCIO = 'negocio-1'
const URL = 'http://localhost/api/agent/voice/reply'

let falso: SupabaseFalso

/** Negocio con la voz completamente encendida: el caso "todo bien" salvo por lo que se prueba. */
const negocio = (extra: Record<string, unknown> = {}) => ({
  id: NEGOCIO,
  dashscope_api_key: null,
  dashscope_endpoint: null,
  agent_settings: {
    voice: { enabled: true, gender: 'female', style: 'warm' },
    behavior: { respond_voice: true, respond_voice_only_if_voice: false, also_send_text: true, max_duration_seconds: 30 },
  },
  ...extra,
})

const responder = async (cuerpo: Record<string, unknown>, secreto?: string) => {
  const respuesta = await POST(peticionAgente(URL, cuerpo, 'POST', secreto))
  return { estado: respuesta.status, cuerpo: await respuesta.json() as Record<string, unknown> }
}

test.beforeEach(async () => {
  falso = await levantarSupabaseFalso({ businesses: [negocio()], platform_settings: [] })
  usarSupabaseFalso(falso)
})

test.afterEach(async () => {
  await falso.cerrar()
})

test.describe('La voz nunca deja mudo al agente', () => {
  test('sin el secreto compartido responde 401, pero pide que se mande el texto', async () => {
    const { estado, cuerpo } = await responder({ businessId: NEGOCIO, text: 'Hola' }, 'secreto-equivocado')
    expect(estado).toBe(401)
    expect(cuerpo.speak).toBe(false)
    expect(cuerpo.sendText).toBe(true)
  })

  test('sin negocio o sin texto no habla y manda texto', async () => {
    const sinTexto = await responder({ businessId: NEGOCIO, text: '   ' })
    expect(sinTexto.cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'datos_incompletos' })

    const sinNegocio = await responder({ text: 'Hola' })
    expect(sinNegocio.cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'datos_incompletos' })
  })

  test('un negocio que no existe no rompe la respuesta', async () => {
    const { cuerpo } = await responder({ businessId: 'negocio-fantasma', text: 'Hola' })
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'negocio_inexistente' })
  })

  test('con la voz apagada en el negocio, texto', async () => {
    falso.tablas.businesses = [negocio({ agent_settings: { voice: { enabled: false }, behavior: { respond_voice: true } } })]
    const { cuerpo } = await responder({ businessId: NEGOCIO, text: 'Hola' })
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'voz_desactivada' })
  })

  test('sin agent_settings tampoco habla: la voz es opt-in', async () => {
    falso.tablas.businesses = [negocio({ agent_settings: null })]
    const { cuerpo } = await responder({ businessId: NEGOCIO, text: 'Hola' })
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'voz_desactivada' })
  })

  test('si el negocio solo responde voz a quien habló por voz, un mensaje escrito va en texto', async () => {
    falso.tablas.businesses = [negocio({
      agent_settings: {
        voice: { enabled: true },
        behavior: { respond_voice: true, respond_voice_only_if_voice: true },
      },
    })]

    const escrito = await responder({ businessId: NEGOCIO, text: 'Hola' })
    expect(escrito.cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'solo_si_hablo_por_voz' })
  })

  test('el límite de duración se respeta: un texto largo no se convierte en un audio eterno', async () => {
    // 30 s * 14 caracteres = 420 caracteres de tope.
    const { cuerpo } = await responder({ businessId: NEGOCIO, text: 'a'.repeat(421) })
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'texto_demasiado_largo' })
  })

  test('sin clave de DashScope (ni del negocio ni de la plataforma) responde texto, no un error', async () => {
    const { estado, cuerpo } = await responder({ businessId: NEGOCIO, text: 'Hola, tu hora quedó agendada.' })
    expect(estado).toBe(200)
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'sin_clave_voz' })
  })

  test('ningún camino devuelve speak:false junto con sendText:false', async () => {
    const casos: Record<string, unknown>[] = [
      { businessId: NEGOCIO, text: '' },
      { businessId: 'negocio-fantasma', text: 'Hola' },
      { businessId: NEGOCIO, text: 'a'.repeat(500) },
      { businessId: NEGOCIO, text: 'Hola' },
      { businessId: NEGOCIO, text: 'Hola', actorType: 'TEAM' },
    ]
    for (const caso of casos) {
      const { cuerpo } = await responder(caso)
      if (cuerpo.speak !== true) expect(cuerpo.sendText, JSON.stringify(caso)).toBe(true)
    }
  })
})

test.describe('En modo equipo el agente nunca habla', () => {
  test('actorType TEAM corta antes de mirar la configuración del negocio', async () => {
    const { cuerpo } = await responder({ businessId: NEGOCIO, text: 'Hola', wasAudio: true, actorType: 'TEAM' })
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'modo_equipo_solo_texto' })
  })

  test('el modo equipo manda aunque el negocio tenga la voz encendida y una clave propia', async () => {
    falso.tablas.businesses = [negocio({ dashscope_api_key: 'clave-que-no-se-debe-usar' })]
    const { cuerpo } = await responder({ businessId: NEGOCIO, text: 'Hola', wasAudio: true, actorType: 'TEAM' })
    expect(cuerpo).toMatchObject({ speak: false, sendText: true, reason: 'modo_equipo_solo_texto' })
    // Si hubiera intentado hablar, habría llamado a DashScope con esa clave.
    expect(cuerpo.audio).toBeUndefined()
  })
})
