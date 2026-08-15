#!/usr/bin/env node
/**
 * Sube el código de UNA herramienta del agente, sin tocar nada más del workflow.
 *
 * Hermana de `npm run n8n -- prompt`, y por la misma razón: el JSON del repositorio puede ir
 * por delante de producción —porque estrena una ruta de la app que aún no está desplegada— y en
 * ese caso subirlo entero está (bien) bloqueado. Pero arreglar una herramienta que solo
 * transforma datos no depende de ningún despliegue.
 *
 *   npm run n8n -- herramienta <nombre>          sube esa herramienta al workflow vivo
 *   npm run n8n -- herramienta <nombre> --ver    solo enseña si difiere, no toca nada
 *
 * Toma el workflow VIVO, le cambia únicamente el `jsCode` de esa herramienta y lo vuelve a
 * guardar. No añade, quita ni reconecta nodos: no puede arrastrar cambios a medias del
 * repositorio.
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

const argumentos = process.argv.slice(2)
const soloVer = argumentos.includes('--ver')
const nombre = argumentos.find((valor) => !valor.startsWith('--'))
if (!nombre) { console.error('Uso: npm run n8n -- herramienta <nombre> [--ver]'); process.exit(2) }

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
const nodoLocal = local.nodes.find((nodo) => nodo.name === nombre)
if (!nodoLocal?.parameters?.jsCode) { console.error(`El repositorio no tiene una herramienta llamada "${nombre}".`); process.exit(2) }

const { data: workflows } = await api('/workflows?limit=100')
const vivo = workflows.find((w) => w.name === local.name)
if (!vivo) { console.error(`No hay ningún workflow llamado "${local.name}".`); process.exit(2) }

const completo = await api(`/workflows/${vivo.id}`)
const nodoVivo = completo.nodes.find((nodo) => nodo.name === nombre)
if (!nodoVivo) { console.error(`El workflow vivo no tiene la herramienta "${nombre}".`); process.exit(2) }

if (nodoVivo.parameters.jsCode === nodoLocal.parameters.jsCode) {
  console.log(`"${nombre}" ya es la del repositorio.`)
  process.exit(0)
}

console.log(`"${nombre}": ${nodoVivo.parameters.jsCode.length} → ${nodoLocal.parameters.jsCode.length} caracteres`)
if (nodoVivo.parameters.description !== nodoLocal.parameters.description) {
  console.log('  (también cambia la descripción que ve el modelo)')
}
if (soloVer) { console.log('(--ver: no se ha tocado nada)'); process.exit(0) }

nodoVivo.parameters.jsCode = nodoLocal.parameters.jsCode
nodoVivo.parameters.description = nodoLocal.parameters.description
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
console.log(`"${nombre}" actualizada en el workflow vivo. El resto no se ha tocado.`)
