#!/usr/bin/env node
/**
 * Sube SOLO el prompt del agente, sin tocar nada más del workflow.
 *
 * Por qué hace falta: el JSON del repositorio puede ir por delante de producción —por ejemplo
 * porque estrena una ruta de la app que todavía no está desplegada— y en ese caso subirlo
 * entero está (bien) bloqueado. Pero una mejora del prompt no depende de ningún despliegue:
 * es texto. Sin esta orden, un arreglo de conducta del agente se quedaba esperando a un clic
 * en EasyPanel sin ninguna razón técnica.
 *
 *   npm run n8n -- prompt            sube el prompt del repositorio al workflow vivo
 *   npm run n8n -- prompt --ver      solo enseña la diferencia, no toca nada
 *
 * Toma el workflow que está VIVO, le cambia únicamente `systemMessage` del nodo del agente y
 * lo vuelve a guardar. No añade, quita ni reconecta nodos, así que no puede arrastrar cambios
 * a medias del repositorio.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const BASE = (process.env.N8N_API_URL ?? '').replace(/\/$/, '')
const CLAVE = process.env.N8N_API_KEY ?? ''
if (!BASE || !CLAVE) { console.error('Faltan N8N_API_URL / N8N_API_KEY en .env.local.'); process.exit(2) }

const soloVer = process.argv.includes('--ver')

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`${BASE}/api/v1${ruta}`, {
    ...opciones,
    headers: { 'X-N8N-API-KEY': CLAVE, 'content-type': 'application/json', ...(opciones.headers ?? {}) },
    signal: AbortSignal.timeout(60000),
  })
  const texto = await respuesta.text()
  let cuerpo = null
  try { cuerpo = JSON.parse(texto) } catch { cuerpo = null }
  if (!respuesta.ok) { console.error(`n8n respondió ${respuesta.status}: ${(cuerpo?.message ?? texto).slice(0, 300)}`); process.exit(1) }
  return cuerpo
}

const local = JSON.parse(readFileSync(path.join(RAIZ, 'n8n-workflows', '01-agen-agent.json'), 'utf8'))
const nodoLocal = local.nodes.find((nodo) => nodo.name === 'Agente Agen')
const promptLocal = nodoLocal?.parameters?.options?.systemMessage
if (!promptLocal) { console.error('El JSON del repositorio no tiene el prompt del agente.'); process.exit(2) }

const { data: workflows } = await api('/workflows?limit=100')
const vivo = workflows.find((w) => w.name === local.name)
if (!vivo) { console.error(`No hay ningún workflow llamado "${local.name}".`); process.exit(2) }

const completo = await api(`/workflows/${vivo.id}`)
const nodoVivo = completo.nodes.find((nodo) => nodo.name === 'Agente Agen')
if (!nodoVivo) { console.error('El workflow vivo no tiene el nodo "Agente Agen".'); process.exit(2) }

const promptVivo = nodoVivo.parameters?.options?.systemMessage ?? ''
if (promptVivo === promptLocal) { console.log('El prompt vivo ya es el del repositorio.'); process.exit(0) }

console.log(`prompt vivo:        ${promptVivo.length} caracteres`)
console.log(`prompt repositorio: ${promptLocal.length} caracteres`)

// Diferencia legible: las frases que entran y las que salen, no un diff carácter a carácter.
const frases = (texto) => texto.split(/(?<=\.)\s+/).map((f) => f.trim()).filter(Boolean)
const vivas = new Set(frases(promptVivo))
const nuevas = new Set(frases(promptLocal))
const entran = [...nuevas].filter((f) => !vivas.has(f))
const salen = [...vivas].filter((f) => !nuevas.has(f))
for (const frase of salen) console.log(`  - ${frase.slice(0, 160)}`)
for (const frase of entran) console.log(`  + ${frase.slice(0, 160)}`)

if (soloVer) { console.log('\n(--ver: no se ha tocado nada)'); process.exit(0) }

nodoVivo.parameters.options.systemMessage = promptLocal
await api(`/workflows/${vivo.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    name: completo.name,
    nodes: completo.nodes,
    connections: completo.connections,
    settings: completo.settings ?? {},
  }),
})
if (completo.active) await api(`/workflows/${vivo.id}/activate`, { method: 'POST' })
console.log('\nPrompt actualizado en el workflow vivo. El resto del workflow no se ha tocado.')
