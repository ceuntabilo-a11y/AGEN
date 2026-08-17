import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * El workflow del agente, comprobado como código y no mirando el lienzo.
 *
 * Un workflow de n8n es un JSON: se puede leer, recorrer y ejecutar. Estas pruebas fijan lo
 * que de verdad importa del router de intención y que ningún cambio futuro puede romper sin
 * enterarse:
 *
 * 1. Las herramientas están restringidas POR RAMA. `crear_reserva`, `liberar_reserva`,
 *    `mover_reserva` y `confirmar_reserva` ya no existen como herramientas del modelo: las
 *    ejecuta `/api/agent/act`. Y la única herramienta que queda, `buscar_horarios`, cuelga
 *    exclusivamente de la rama que busca horarios.
 * 2. Toda rama termina enviando algo al cliente. Ninguna se queda muda.
 * 3. La puerta de entrada sigue descartando grupos, difusión, estados y mensajes propios, y
 *    ahora además reconoce imágenes y notas de voz.
 */

const WORKFLOW = path.join(process.cwd(), 'n8n-workflows', '01-agen-agent.json')
const workflow = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8')) as {
  nodes: Array<Record<string, any>>
  connections: Record<string, Record<string, Array<Array<{ node: string; type: string }>>>>
}

const nombres = workflow.nodes.map((nodo) => nodo.name)
const nodo = (nombre: string) => workflow.nodes.find((item) => item.name === nombre)

/** Ejecuta la expresión de un nodo Set como la ejecutaría n8n. */
function ejecutarEntrada(raw: Record<string, unknown>) {
  const expresion = String(nodo('Entrada')!.parameters.jsonOutput)
    .replace(/^=\{\{/, '').replace(/\}\}$/, '').trim()
  const dolar = (nombreNodo: string) => {
    if (nombreNodo !== 'Webhook') throw new Error(`nodo inesperado: ${nombreNodo}`)
    return { first: () => ({ json: raw }) }
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('$', '$execution', `return (${expresion})`)
  return JSON.parse(fn(dolar, { id: '77' }) as string) as Record<string, any>
}

const mensajeDe = (extra: Record<string, unknown>) => ({
  headers: {}, query: {},
  body: { businessId: 'neg-1', instance: 'Agen', ...extra },
})

test.describe('Herramientas restringidas por rama', () => {
  test('el modelo ya no puede reservar, cancelar, mover ni confirmar', async () => {
    const herramientas = workflow.nodes.filter((item) => String(item.type).includes('toolCode')).map((item) => item.name)
    expect(herramientas).toEqual(['buscar_horarios'])
    for (const prohibida of ['crear_reserva', 'liberar_reserva', 'mover_reserva', 'confirmar_reserva', 'registrar_cliente']) {
      expect(nombres, `"${prohibida}" no puede seguir siendo una herramienta del modelo`).not.toContain(prohibida)
    }
  })

  test('buscar_horarios cuelga SOLO de la rama que busca horarios', async () => {
    const destinos = workflow.connections['buscar_horarios']?.ai_tool?.flat().map((item) => item.node) ?? []
    expect(destinos).toEqual(['Buscador'])
  })

  test('el redactor y el decisor no tienen ninguna herramienta conectada', async () => {
    const conHerramienta = new Set(
      Object.values(workflow.connections)
        .flatMap((salidas) => salidas.ai_tool?.flat() ?? [])
        .map((item) => item.node),
    )
    expect(conHerramienta.has('Redactor')).toBe(false)
    expect(conHerramienta.has('Decisor')).toBe(false)
  })

  test('quien ejecuta las acciones es un nodo de código, no el modelo', async () => {
    const ejecutor = nodo('Ejecutar acción')
    expect(ejecutor?.type).toBe('n8n-nodes-base.httpRequest')
    expect(String(ejecutor?.parameters.url)).toContain('/api/agent/act')
    // Y le llega justo lo que dijo el decisor, para que la app lo valide contra la base.
    expect(String(ejecutor?.parameters.body)).toContain('decision')
  })
})

test.describe('Ninguna rama deja al cliente sin respuesta', () => {
  const alcanza = (desde: string, hasta: string) => {
    const vistos = new Set<string>()
    const pila = [desde]
    while (pila.length) {
      const actual = pila.pop()!
      if (actual === hasta) return true
      if (vistos.has(actual)) continue
      vistos.add(actual)
      for (const grupo of workflow.connections[actual]?.main ?? []) {
        for (const salida of grupo ?? []) pila.push(salida.node)
      }
    }
    return false
  }

  for (const rama of ['Respuesta directa', 'No pude consultar', 'Buscador', 'Redactor', 'Decisor']) {
    test(`"${rama}" termina enviando el mensaje`, async () => {
      expect(alcanza(rama, 'Enviar a WhatsApp')).toBe(true)
    })
  }

  test('el turno siempre acaba contestándole al webhook', async () => {
    for (const rama of ['Rechazar', 'Ignorar', 'Ya respondió otro']) {
      expect(nodo(rama)?.type, rama).toBe('n8n-nodes-base.respondToWebhook')
    }
    expect(alcanza('Enviar a WhatsApp', 'Responder')).toBe(true)
  })

  test('sin contexto NO se llega a ningún modelo (defecto D1)', async () => {
    const salidas = workflow.connections['¿Hay contexto?'].main
    // Salida falsa = no hay contexto: va al mensaje honesto, no al agente.
    expect(salidas[1][0].node).toBe('No pude consultar')
    expect(alcanza('No pude consultar', 'Buscador')).toBe(false)
    expect(alcanza('No pude consultar', 'Redactor')).toBe(false)
    expect(alcanza('No pude consultar', 'Decisor')).toBe(false)
  })
})

test.describe('Puerta de entrada', () => {
  test('un mensaje de texto normal se atiende', async () => {
    const salida = ejecutarEntrada(mensajeDe({
      data: { key: { remoteJid: '56911112222@s.whatsapp.net', id: 'A1' }, message: { conversation: 'hola' } },
    }))
    expect(salida.atender).toBe(true)
    expect(salida.body.phone).toBe('+56911112222')
    expect(salida.body.message).toBe('hola')
    expect(salida.mediaType).toBeNull()
  })

  test('una imagen SIN texto ahora se atiende, y se marca como imagen', async () => {
    const salida = ejecutarEntrada(mensajeDe({
      data: { key: { remoteJid: '56911112222@s.whatsapp.net', id: 'A2' }, message: { imageMessage: { caption: '' } } },
    }))
    expect(salida.atender).toBe(true)
    expect(salida.mediaType).toBe('image')
  })

  test('una nota de voz se marca como audio', async () => {
    const salida = ejecutarEntrada(mensajeDe({
      data: { key: { remoteJid: '56911112222@s.whatsapp.net', id: 'A3' }, message: { audioMessage: { seconds: 4 } } },
    }))
    expect(salida.atender).toBe(true)
    expect(salida.mediaType).toBe('audio')
  })

  for (const [caso, data] of [
    ['un grupo', { key: { remoteJid: '1203@g.us', id: 'B1' }, message: { conversation: 'hola' } }],
    ['una difusión', { key: { remoteJid: '9@broadcast', id: 'B2' }, message: { conversation: 'hola' } }],
    ['un mensaje propio', { key: { remoteJid: '56911112222@s.whatsapp.net', id: 'B3', fromMe: true }, message: { conversation: 'hola' } }],
    ['un JID que no es teléfono', { key: { remoteJid: 'abc@s.whatsapp.net', id: 'B4' }, message: { conversation: 'hola' } }],
    ['un mensaje vacío', { key: { remoteJid: '56911112222@s.whatsapp.net', id: 'B5' }, message: {} }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`${caso} se sigue ignorando`, async () => {
      expect(ejecutarEntrada(mensajeDe({ data })).atender).toBe(false)
    })
  }
})

test.describe('Restos del diseño anterior', () => {
  test('no queda ninguna referencia al nodo inexistente "Cargar catálogo" (defecto D5)', async () => {
    expect(JSON.stringify(workflow)).not.toContain('Cargar cat')
  })

  test('las instrucciones de cada rama vienen de la app, no escritas en el lienzo', async () => {
    for (const rama of ['Buscador', 'Redactor', 'Decisor']) {
      const mensaje = String(nodo(rama)?.parameters.options.systemMessage ?? '')
      expect(mensaje, rama).toContain("$('Turno').first().json.systemMessage")
    }
  })

  test('cada nodo apuntado por una conexión existe de verdad', async () => {
    for (const [origen, salidas] of Object.entries(workflow.connections)) {
      expect(nombres, `origen "${origen}"`).toContain(origen)
      for (const grupos of Object.values(salidas)) {
        for (const grupo of grupos) {
          for (const salida of grupo ?? []) expect(nombres, `destino desde "${origen}"`).toContain(salida.node)
        }
      }
    }
  })
})
