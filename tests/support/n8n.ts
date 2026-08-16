import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Arnés para probar la construcción del contexto del agente sin levantar n8n.
 *
 * El mensaje que recibe el modelo no se escribe en TypeScript: es una expresión de n8n
 * guardada en `n8n-workflows/01-agen-agent.json`, nodo "Agente Agen", campo `parameters.text`.
 * Estas utilidades leen esa expresión REAL del workflow versionado y la evalúan con datos
 * de prueba, de modo que la prueba falla si alguien rompe la plantilla.
 */

const RUTA_WORKFLOW = path.resolve(__dirname, '..', '..', 'n8n-workflows', '01-agen-agent.json')

type NodoN8n = { name: string; type: string; parameters: Record<string, unknown> }

type Conexiones = Record<string, Record<string, Array<Array<{ node: string; type: string; index: number }>>>>

export function cargarWorkflow(): { nodes: NodoN8n[]; connections: Conexiones } {
  return JSON.parse(readFileSync(RUTA_WORKFLOW, 'utf8')) as { nodes: NodoN8n[]; connections: Conexiones }
}

export function nodo(nombre: string): NodoN8n {
  const encontrado = cargarWorkflow().nodes.find((item) => item.name === nombre)
  if (!encontrado) throw new Error(`El workflow no tiene un nodo llamado "${nombre}"`)
  return encontrado
}

/** Datos con los que se evalúa la plantilla: el item que entra y los nodos referenciados. */
export type EntradaContexto = {
  /** Lo que llega al nodo del agente: memoria + catálogo ya unidos por el nodo Merge. */
  json: Record<string, unknown>
  /** Salida de otros nodos a los que la plantilla accede con $('Nombre'). */
  nodos: Record<string, Record<string, unknown>>
}

/**
 * Evalúa la expresión `={{ … }}` del nodo indicado.
 *
 * Solo soporta la forma que usa este workflow: una única expresión que ocupa todo el campo.
 * Si el formato cambiara, la prueba falla con un mensaje explícito en vez de en silencio.
 */
export function evaluarExpresion(expresion: string, datos: EntradaContexto): string {
  if (!expresion.startsWith('=')) throw new Error('La plantilla debería empezar con "=" (expresión de n8n)')
  const cuerpo = expresion.slice(1).trim()
  if (!cuerpo.startsWith('{{') || !cuerpo.endsWith('}}')) {
    throw new Error('Se esperaba una única expresión {{ … }} ocupando todo el campo')
  }
  const codigo = cuerpo.slice(2, -2)

  const referencia = (nombre: string) => {
    const valor = datos.nodos[nombre]
    if (!valor) throw new Error(`La plantilla usa $('${nombre}') y la prueba no lo definió`)
    return { item: { json: valor }, first: () => ({ json: valor }) }
  }

  // La expresión viene del workflow versionado del propio repositorio, no de una entrada
  // externa: evaluarla es justamente lo que se quiere probar.
  const evaluar = new Function('$json', '$', `return (${codigo})`) as (
    json: Record<string, unknown>,
    ref: typeof referencia,
  ) => unknown

  return String(evaluar(datos.json, referencia))
}

/**
 * Ejecuta el `jsCode` real de un nodo Code con los nodos referenciados simulados.
 * `$execution` se pasa aparte para poder probar también el caso en que n8n no lo expone.
 */
export function ejecutarNodoCodigo(
  nombre: string,
  nodos: Record<string, Record<string, unknown>>,
  ejecucion?: { id?: string },
): Record<string, unknown> {
  const { jsCode } = nodo(nombre).parameters as { jsCode?: string }
  if (typeof jsCode !== 'string') throw new Error(`El nodo "${nombre}" no es un nodo Code`)

  const referencia = (referido: string) => {
    const valor = nodos[referido]
    if (!valor) throw new Error(`El nodo "${nombre}" usa $('${referido}') y la prueba no lo definió`)
    return { item: { json: valor }, first: () => ({ json: valor }) }
  }

  const ejecutar = new Function('$', '$execution', jsCode) as (
    ref: typeof referencia,
    execution: { id?: string } | undefined,
  ) => Array<{ json: Record<string, unknown> }>

  const salida = ejecutar(referencia, ejecucion)
  if (!Array.isArray(salida) || !salida[0]?.json) throw new Error(`El nodo "${nombre}" no devolvió [{ json }]`)
  return salida[0].json
}

/** Cuerpo JSON que un nodo HTTP le manda a la app, evaluado con datos de prueba. */
export function cuerpoDelNodo<T = Record<string, unknown>>(nombre: string, datos: EntradaContexto): T {
  const { body } = nodo(nombre).parameters as { body?: string }
  if (typeof body !== 'string') throw new Error(`El nodo "${nombre}" no manda un cuerpo`)
  const crudo = evaluarExpresion(body, datos)
  try {
    return JSON.parse(crudo) as T
  } catch {
    throw new Error(`El cuerpo de "${nombre}" no es JSON válido: ${crudo.slice(0, 120)}`)
  }
}

/** Instrucciones de sistema del agente, tal como están en el workflow versionado. */
export function promptDelSistema(): string {
  const opciones = nodo('Agente Agen').parameters.options as { systemMessage?: string } | undefined
  if (!opciones?.systemMessage) throw new Error('El nodo del agente no tiene systemMessage')
  return opciones.systemMessage
}

/** Construye el mensaje de usuario tal como lo recibirá el modelo. */
export function contextoDelAgente(datos: EntradaContexto): string {
  return evaluarExpresion(String(nodo('Agente Agen').parameters.text), datos)
}

/**
 * Parte el contexto en sus campos `CLAVE: valor`.
 * Las líneas se generan con `'\nCLAVE: ' + …`, así que una clave por línea.
 */
export function camposDelContexto(contexto: string): Record<string, string> {
  const campos: Record<string, string> = {}
  for (const linea of contexto.split('\n')) {
    const separador = linea.indexOf(': ')
    if (separador <= 0) continue
    const clave = linea.slice(0, separador)
    if (!/^[A-ZÁÉÍÓÚÑ_]+$/.test(clave)) continue
    campos[clave] = linea.slice(separador + 2)
  }
  return campos
}

/** Lee un campo del contexto y lo devuelve parseado como JSON. */
export function campoJson<T = unknown>(contexto: string, clave: string): T {
  const valor = camposDelContexto(contexto)[clave]
  if (valor === undefined) throw new Error(`El contexto no incluye el campo ${clave}`)
  try {
    return JSON.parse(valor) as T
  } catch {
    throw new Error(`El campo ${clave} no es JSON válido: ${valor.slice(0, 120)}`)
  }
}
