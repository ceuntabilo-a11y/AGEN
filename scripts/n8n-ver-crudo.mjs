#!/usr/bin/env node
/**
 * La respuesta COMPLETA de una herramienta en una ejecución, sin recortar.
 *
 * `npm run n8n -- dijo <id>` recorta a 500 caracteres para que se lea de un vistazo, y eso
 * basta casi siempre. Pero cuando lo que hay que comprobar es un campo concreto que llega al
 * final del JSON —por ejemplo si `/api/agent/slots` está devolviendo ya `dia`, `hora` y
 * `franja` resueltos— el recorte lo esconde, y "no lo veo" se confunde con "no está".
 *
 *   npm run n8n -- crudo <idDeEjecucion> <nombreDeLaHerramienta> [campo]
 *
 * Con `campo`, imprime solo ese campo del primer elemento de `slots` (o del cuerpo entero si
 * no hay `slots`). Sin él, imprime el cuerpo completo con sangría.
 *
 * Solo lectura. No imprime cabeceras: ahí viaja el secreto compartido.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const BASE = (process.env.N8N_API_URL ?? '').replace(/\/$/, '')
const CLAVE = process.env.N8N_API_KEY ?? ''
if (!BASE || !CLAVE) { console.error('Faltan N8N_API_URL / N8N_API_KEY en .env.local.'); process.exit(2) }

const [id, herramienta, campo] = process.argv.slice(2)
if (!id || !herramienta) {
  console.error('Uso: npm run n8n -- crudo <idDeEjecucion> <herramienta> [campo]')
  process.exit(2)
}

const respuesta = await fetch(`${BASE}/api/v1/executions/${id}?includeData=true`, {
  headers: { 'X-N8N-API-KEY': CLAVE },
  signal: AbortSignal.timeout(60000),
})
if (!respuesta.ok) { console.error(`n8n respondió ${respuesta.status}`); process.exit(1) }
const ejecucion = await respuesta.json()

const corridas = ejecucion?.data?.resultData?.runData?.[herramienta]
if (!corridas?.length) { console.error(`La ejecución ${id} no usó "${herramienta}".`); process.exit(1) }

for (const corrida of corridas) {
  const salida = corrida?.data?.ai_tool?.[0]?.[0]?.json?.response
  if (!salida) continue
  let cuerpo = salida
  try { cuerpo = JSON.parse(salida) } catch {}
  const contenido = cuerpo?.body ?? cuerpo

  if (!campo) { console.log(JSON.stringify(contenido, null, 1)); continue }

  const primero = Array.isArray(contenido?.slots) ? contenido.slots[0] : contenido
  console.log(`${campo}: ${JSON.stringify(primero?.[campo])}`)
}
