import { test, expect } from '@playwright/test'
import { cargarWorkflow, nodo } from '../support/n8n'

/**
 * Dos fallos que dejaban al cliente sin respuesta, encontrados midiendo ejecuciones reales del
 * n8n de producción (no deducidos: `npm run n8n -- ejecucion <id>` los enseña por nodo).
 *
 * 1. **El agente no contestaba a NADIE.** En las 100 ejecuciones más recientes del workflow 01,
 *    cero llegaron al modelo. La causa: después del nodo `Esperar` (la pausa de 3 s que agrupa
 *    mensajes seguidos), n8n pierde el emparejado de items, así que `$('Entrada').item` deja de
 *    resolver. El primer nodo tras la espera —`Agrupar`— mandaba `{}` a `/api/agent/inbox`,
 *    recibía 400 "Datos incompletos", y el flujo se iba por la rama "Ya respondió otro". Todo
 *    el tramo posterior (contexto, modelo, envío) usaba la misma forma rota.
 *    `$('Nodo').first()` no depende del emparejado y en este workflow es equivalente: cada
 *    ejecución procesa exactamente un mensaje.
 *
 * 2. **Nada acotaba el tiempo.** Los HTTP Request de n8n sin `timeout` explícito usan 300 s por
 *    defecto. `Enviar a WhatsApp` reintentaba 3 veces, así que una dependencia colgada podía
 *    tener la ejecución 15 minutos — que es de dónde salen las interacciones de ~8 minutos que
 *    se observaron. Acotarlo no es "subir un timeout": es ponerle un techo a algo que no lo
 *    tenía.
 */

const workflow = cargarWorkflow()

/** Nodos que se ejecutan DESPUÉS del `Esperar`, donde el emparejado de items ya no vale. */
const TRAS_LA_ESPERA = [
  'Agrupar', 'Cargar memoria', 'Cargar catálogo', 'Agente Agen',
  'Memoria reciente', 'Enviar a WhatsApp', 'Persistir interacción', 'Responder',
]

test.describe('El emparejado de items no puede volver a romper la respuesta', () => {
  test('ningún nodo del workflow usa $(...).item', () => {
    const culpables = workflow.nodes
      .filter((n) => JSON.stringify(n.parameters).includes(").item"))
      .map((n) => n.name)
    expect(
      culpables,
      'tras el nodo Esperar, $(...).item deja de resolver y el nodo manda un cuerpo vacío. Usa .first().',
    ).toEqual([])
  })

  test('los nodos posteriores a la espera leen el contexto con .first()', () => {
    for (const nombre of TRAS_LA_ESPERA) {
      const cuerpo = JSON.stringify(nodo(nombre).parameters)
      if (!cuerpo.includes("$('")) continue
      expect(cuerpo, `"${nombre}" tiene que usar .first()`).toContain(".first()")
    }
  })

  test('Agrupar manda los tres datos que /api/agent/inbox exige', () => {
    // Los tres que valida el PUT: sin uno solo responde 400 y nadie contesta al cliente.
    const cuerpo = String((nodo('Agrupar').parameters as { body: string }).body)
    for (const campo of ['businessId', 'phone', 'messageId']) expect(cuerpo).toContain(campo)
    expect(cuerpo).not.toContain(").item")
  })
})

test.describe('Toda llamada de red tiene techo de tiempo', () => {
  const http = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest')

  test('hay nodos HTTP que comprobar', () => {
    expect(http.length).toBeGreaterThan(4)
  })

  test('ningún HTTP Request se queda sin timeout', () => {
    for (const n of http) {
      const opciones = (n.parameters as { options?: { timeout?: number } }).options ?? {}
      expect(opciones.timeout, `"${n.name}" sin timeout: heredaría los 300 s por defecto de n8n`).toBeTruthy()
      expect(opciones.timeout, `"${n.name}" con un techo demasiado alto`).toBeLessThanOrEqual(30000)
    }
  })

  test('el envío al cliente no puede tardar minutos en rendirse', () => {
    const envio = workflow.nodes.find((n) => n.name === 'Enviar a WhatsApp')!
    const opciones = (envio.parameters as { options: { timeout: number } }).options
    const intentos = (envio as { maxTries?: number }).maxTries ?? 1
    // Peor caso completo: intentos × timeout. Con 3 × 300 s eran 15 minutos.
    expect(opciones.timeout * intentos).toBeLessThanOrEqual(60000)
  })

  test('el modelo también tiene techo', () => {
    const opciones = (nodo('Modelo').parameters as { options?: { timeout?: number } }).options ?? {}
    expect(opciones.timeout).toBeTruthy()
  })

  test('las herramientas del agente acotan su llamada a la app', () => {
    const herramientas = workflow.nodes.filter((n) => n.type === '@n8n/n8n-nodes-langchain.toolCode')
    expect(herramientas.length).toBeGreaterThan(5)
    for (const n of herramientas) {
      const codigo = String((n.parameters as { jsCode: string }).jsCode)
      expect(codigo, `la herramienta "${n.name}" no acota su petición`).toContain('timeout:')
    }
  })
})
