#!/usr/bin/env node
/**
 * Diagnóstico de SOLO LECTURA: estado real del proyecto de Supabase (Management API), para
 * investigar fallas de conexión sin adivinar. No imprime ningún secreto.
 *
 *   npm run supabase-diag
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN ?? ''
const REF = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? ''

if (!TOKEN) { console.error('No hay SUPABASE_MANAGEMENT_TOKEN en .env.local.'); process.exit(2) }
if (!REF) { console.error('No se pudo extraer la referencia del proyecto desde NEXT_PUBLIC_SUPABASE_URL.'); process.exit(2) }

async function api(ruta) {
  const respuesta = await fetch(`https://api.supabase.com/v1${ruta}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  const texto = await respuesta.text()
  let cuerpo
  try { cuerpo = JSON.parse(texto) } catch { cuerpo = texto }
  return { ok: respuesta.ok, status: respuesta.status, cuerpo }
}

console.log(`Proyecto: ${REF}\n`)

const proyecto = await api(`/projects/${REF}`)
console.log('--- Estado del proyecto ---')
console.log(proyecto.ok ? JSON.stringify(proyecto.cuerpo, null, 2) : `${proyecto.status}: ${JSON.stringify(proyecto.cuerpo)}`)

const salud = await api(`/projects/${REF}/health?services=auth,rest,db`)
console.log('\n--- Salud de servicios (auth, rest, db) ---')
console.log(salud.ok ? JSON.stringify(salud.cuerpo, null, 2) : `${salud.status}: ${JSON.stringify(salud.cuerpo)}`)

const pooler = await api(`/projects/${REF}/config/database/pooler`)
console.log('\n--- Configuración del pooler de conexiones ---')
console.log(pooler.ok ? JSON.stringify(pooler.cuerpo, null, 2) : `${pooler.status}: ${JSON.stringify(pooler.cuerpo)}`)

const auth = await api(`/projects/${REF}/config/auth`)
console.log('\n--- Límites de la API de Auth (rate limits) ---')
if (auth.ok) {
  const c = auth.cuerpo
  console.log(JSON.stringify({
    rate_limit_token_refresh: c.rate_limit_token_refresh,
    rate_limit_verify: c.rate_limit_verify,
    rate_limit_anonymous_users: c.rate_limit_anonymous_users,
    rate_limit_otp: c.rate_limit_otp,
    site_url: c.site_url,
    uri_allow_list: c.uri_allow_list,
  }, null, 2))
} else {
  console.log(`${auth.status}: ${JSON.stringify(auth.cuerpo)}`)
}
