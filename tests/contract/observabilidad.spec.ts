import { test, expect } from '@playwright/test'
import { registrar, sanear } from '@/lib/observabilidad'

/**
 * El registro de eventos no puede convertirse en una fuga de secretos.
 *
 * Es la contrapartida del valor que aporta: para que sirva hay que meterle contexto, y el
 * contexto es exactamente donde se cuelan una clave de OpenAI o un token. Estas pruebas fijan
 * que el saneado ocurre siempre, incluso cuando quien llama se equivoca y pasa la clave.
 */

const capturar = (nivel: 'log' | 'error', cuerpo: () => void): string[] => {
  const lineas: string[] = []
  const original = console[nivel]
  console[nivel] = (...args: unknown[]) => { lineas.push(String(args[0])) }
  try { cuerpo() } finally { console[nivel] = original }
  return lineas
}

test.describe('Nunca sale un secreto en los logs', () => {
  test('un campo que se llama como una credencial se oculta, valga lo que valga', () => {
    const salida = sanear({ apiKey: 'sk-real-123', token: 'abc', password: 'x', Authorization: 'Bearer y', clave_openai: 'z' })
    for (const valor of Object.values(salida)) expect(valor).toBe('[oculto]')
  })

  test('un secreto escondido en un campo de nombre inocente también se oculta', () => {
    const salida = sanear({ detalle: 'sk-proj-abcdefghijklmnop', otro: 'ghp_abcdefghijklmnop', jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' })
    expect(salida.detalle).toBe('[oculto]')
    expect(salida.otro).toBe('[oculto]')
    expect(salida.jwt).toBe('[oculto]')
  })

  test('el saneado entra también en los objetos anidados', () => {
    const salida = sanear({ negocio: { id: 'n1', openai_api_key: 'sk-x' } }) as { negocio: Record<string, unknown> }
    expect(salida.negocio.id).toBe('n1')
    expect(salida.negocio.openai_api_key).toBe('[oculto]')
  })

  test('lo que no es secreto se conserva tal cual', () => {
    const salida = sanear({ businessId: 'negocio-1', httpEstado: 429, reintento: true, motivo: null })
    expect(salida).toEqual({ businessId: 'negocio-1', httpEstado: 429, reintento: true, motivo: null })
  })

  test('un texto enorme se recorta: un log no es un volcado', () => {
    const salida = sanear({ cuerpo: 'a'.repeat(5000) }) as { cuerpo: string }
    expect(salida.cuerpo.length).toBeLessThan(320)
    expect(salida.cuerpo.endsWith('…')).toBe(true)
  })

  test('un Error se registra como nombre y mensaje, sin la traza entera', () => {
    const salida = sanear({ error: new TypeError('fetch failed') }) as { error: string }
    expect(salida.error).toBe('TypeError: fetch failed')
  })
})

test.describe('El formato es una línea JSON con lo mínimo para buscarla', () => {
  test('lleva marca de tiempo, nivel y nombre del evento', () => {
    const [linea] = capturar('log', () => registrar('aviso', 'agent_media_sin_clave', { businessId: 'negocio-1' }))
    const evento = JSON.parse(linea) as Record<string, unknown>
    expect(evento.evento).toBe('agent_media_sin_clave')
    expect(evento.nivel).toBe('aviso')
    expect(evento.businessId).toBe('negocio-1')
    expect(typeof evento.ts).toBe('string')
    expect(Number.isNaN(Date.parse(String(evento.ts)))).toBe(false)
  })

  test('los errores van por stderr y el resto por stdout', () => {
    expect(capturar('error', () => registrar('error', 'agent_voz_excepcion'))).toHaveLength(1)
    expect(capturar('log', () => registrar('info', 'algo'))).toHaveLength(1)
    // Y no al revés: un error no puede perderse en stdout.
    expect(capturar('log', () => registrar('error', 'agent_voz_excepcion'))).toHaveLength(0)
  })

  test('cada evento es UNA sola línea, aunque el contexto traiga saltos', () => {
    const [linea] = capturar('log', () => registrar('aviso', 'x', { detalle: 'primera\nsegunda' }))
    expect(linea.split('\n')).toHaveLength(1)
  })
})
