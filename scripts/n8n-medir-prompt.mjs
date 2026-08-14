#!/usr/bin/env node
/**
 * Cuánto texto recibe el modelo en cada turno, y de dónde sale.
 *
 * El modelo es la mitad del tiempo de una conversación (4,5–13,3 s por llamada, medido con
 * `npm run n8n -- ejecucion`). Antes de tocar nada hay que saber qué se le está mandando: el
 * prompt del sistema es fijo, pero el contexto se arma en cada turno con la ficha del negocio,
 * el catálogo completo, las reservas del cliente y las referencias temporales.
 *
 *   npm run n8n -- medir-prompt [idDeEjecucion]
 *
 * Sin id, mide solo la parte fija (el prompt del sistema y la plantilla). Con id, mide además
 * lo que de verdad se mandó en esa ejecución, campo por campo.
 *
 * Los caracteres no son tokens, pero la proporción sí sirve para decidir dónde recortar: en
 * español, aproximadamente 4 caracteres por token.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const workflow = JSON.parse(readFileSync(path.join(RAIZ, 'n8n-workflows', '01-agen-agent.json'), 'utf8'))
const agente = workflow.nodes.find((nodo) => nodo.name === 'Agente Agen')
const sistema = String(agente?.parameters?.options?.systemMessage ?? '')

const tokens = (texto) => Math.round(texto.length / 4)
const linea = (nombre, texto) => `  ${nombre.padEnd(22)} ${String(texto.length).padStart(7)} car.  ≈ ${String(tokens(texto)).padStart(5)} tokens`

console.log('Parte fija (igual en todos los turnos):')
console.log(linea('prompt del sistema', sistema))

const id = process.argv[2]
if (!id) {
  console.log('\nPasa un id de ejecución para medir también el contexto real de ese turno.')
  process.exit(0)
}

const BASE = (process.env.N8N_API_URL ?? '').replace(/\/$/, '')
const CLAVE = process.env.N8N_API_KEY ?? ''
if (!BASE || !CLAVE) { console.error('Faltan N8N_API_URL / N8N_API_KEY en .env.local.'); process.exit(2) }

const respuesta = await fetch(`${BASE}/api/v1/executions/${id}?includeData=true`, {
  headers: { 'X-N8N-API-KEY': CLAVE },
  signal: AbortSignal.timeout(60000),
})
if (!respuesta.ok) { console.error(`n8n respondió ${respuesta.status}`); process.exit(1) }
const ejecucion = await respuesta.json()
const corridas = ejecucion?.data?.resultData?.runData ?? {}

/*
 * El contexto no se guarda como tal, pero sus ingredientes sí: son las salidas de "Cargar
 * memoria" y "Cargar catálogo", que es exactamente lo que la plantilla serializa.
 */
const contexto = corridas['Unir contexto']?.[0]?.data?.main?.[0]?.[0]?.json
if (!contexto) { console.log('\nEsa ejecución no llegó a armar el contexto.'); process.exit(0) }

const partes = {
  SERVICIOS: contexto.services ?? [],
  RESERVAS: contexto.appointments ?? [],
  CLIENTE: contexto.client ?? null,
  FICHA: contexto.business ?? null,
  TIEMPO: contexto.time ?? null,
  SUCURSALES: contexto.branches ?? [],
}

console.log('\nContexto de ese turno, campo por campo:')
let total = sistema.length
for (const [nombre, valor] of Object.entries(partes)) {
  const texto = JSON.stringify(valor ?? null)
  total += texto.length
  console.log(linea(nombre, texto))
}
console.log(`\n  TOTAL aproximado      ${String(total).padStart(7)} car.  ≈ ${tokens(String(total).padStart(1)) && Math.round(total / 4)} tokens de entrada por turno`)
console.log('\nDónde recortar se decide con esta tabla, no de memoria.')
