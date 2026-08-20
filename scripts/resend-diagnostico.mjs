#!/usr/bin/env node
/**
 * Diagnóstico de SOLO LECTURA: qué pasó de verdad con los últimos correos que mandó Agen por
 * Resend. No imprime la clave ni ningún secreto, solo el resultado de la entrega.
 *
 *   npm run resend -- [correo-a-buscar]
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const filtro = (process.argv[2] ?? '').toLowerCase()

async function credencialesResend() {
  if (SUPABASE_URL && SERVICE_KEY) {
    const respuesta = await fetch(`${SUPABASE_URL}/rest/v1/platform_settings?key=in.(resend_api_key,resend_from)&select=key,value`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (respuesta.ok) {
      const filas = await respuesta.json()
      const clave = filas.find((f) => f.key === 'resend_api_key')?.value
      const desde = filas.find((f) => f.key === 'resend_from')?.value
      if (clave) return { clave, desde: desde || process.env.RESEND_FROM || '' }
    }
  }
  return { clave: process.env.RESEND_API_KEY ?? '', desde: process.env.RESEND_FROM ?? '' }
}

const { clave } = await credencialesResend()
if (!clave) { console.error('No hay clave de Resend disponible (ni en platform_settings ni en .env.local).'); process.exit(2) }

const respuesta = await fetch('https://api.resend.com/emails?limit=50', {
  headers: { authorization: `Bearer ${clave}` },
})
if (!respuesta.ok) {
  console.error(`Resend respondió ${respuesta.status} al listar correos.`)
  const texto = await respuesta.text().catch(() => '')
  if (texto) console.error(texto.slice(0, 500))
  process.exit(1)
}
const cuerpo = await respuesta.json()
const lista = cuerpo.data ?? cuerpo.emails ?? (Array.isArray(cuerpo) ? cuerpo : [])
const filtrados = filtro ? lista.filter((c) => (c.to ?? []).some((d) => String(d).toLowerCase().includes(filtro))) : lista

if (!filtrados.length) { console.log(filtro ? `Sin correos a "${filtro}" en los últimos ${lista.length} enviados.` : 'Resend no tiene correos registrados.'); process.exit(0) }

for (const correo of filtrados) {
  console.log(`${correo.created_at} · ${(correo.to ?? []).join(', ')} · asunto: ${correo.subject} · estado: ${correo.last_event ?? '(sin dato)'}`)
}
