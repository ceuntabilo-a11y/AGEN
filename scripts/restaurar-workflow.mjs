/**
 * Restaura en el n8n real un workflow guardado en el repositorio, tal cual está el archivo.
 *
 *   node scripts/restaurar-workflow.mjs <archivo.json> <id>
 *
 * Existe por un motivo concreto: un workflow EXPORTADO del servidor trae ajustes que el propio
 * servidor guarda pero que el esquema de `PUT /api/v1/workflows/{id}` rechaza (`binaryMode`).
 * Es decir, el respaldo no se podía volver a subir con `npm run n8n -- subir`, que es justo
 * cuando más falta hace. Acá se limpian los ajustes a los que la API acepta y nada más.
 *
 * No borra nada, no toca credenciales y no cambia el estado activo/inactivo del workflow.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const BASE = (process.env.N8N_API_URL ?? '').replace(/\/$/, '')
const CLAVE = process.env.N8N_API_KEY ?? ''
if (!BASE || !CLAVE) { console.error('Faltan N8N_API_URL y/o N8N_API_KEY en .env.local.'); process.exit(2) }

const [archivo, id] = process.argv.slice(2)
if (!archivo || !id) { console.error('Uso: node scripts/restaurar-workflow.mjs <archivo.json> <id>'); process.exit(2) }

const AJUSTES_QUE_ACEPTA_LA_API = [
  'executionOrder', 'saveManualExecutions', 'callerPolicy', 'timezone',
  'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveExecutionProgress',
  'executionTimeout', 'errorWorkflow',
]

const local = JSON.parse(readFileSync(path.resolve(RAIZ, archivo), 'utf8'))
const cuerpo = {
  name: local.name,
  nodes: local.nodes,
  connections: local.connections,
  settings: Object.fromEntries(
    Object.entries(local.settings ?? { executionOrder: 'v1' })
      .filter(([clave]) => AJUSTES_QUE_ACEPTA_LA_API.includes(clave)),
  ),
}

const respuesta = await fetch(`${BASE}/api/v1/workflows/${id}`, {
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': CLAVE, 'content-type': 'application/json' },
  body: JSON.stringify(cuerpo),
})
const texto = await respuesta.text()
if (!respuesta.ok) { console.error(`n8n respondió ${respuesta.status}: ${texto.slice(0, 300)}`); process.exit(1) }

const datos = JSON.parse(texto)
console.log(`Restaurado "${datos.name}" (${id}) con ${cuerpo.nodes.length} nodos.`)
console.log(datos.active ? 'Sigue activo.' : 'Está inactivo: actívalo cuando lo hayas probado.')
