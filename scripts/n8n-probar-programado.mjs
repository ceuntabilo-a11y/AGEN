#!/usr/bin/env node
/**
 * Comprobar que un workflow programado se dispara DE VERDAD, sin esperar a su hora.
 *
 * El problema que resuelve: un workflow con disparador horario o diario tarda horas en
 * demostrar que funciona, así que en la práctica nunca se comprueba — "está activo" se toma
 * por "funciona". El AGEN 04 llevaba horas así.
 *
 * Esto acelera temporalmente su disparador a un minuto, espera a que corra, enseña el
 * resultado y **restaura el disparador original** pase lo que pase.
 *
 *   npm run n8n -- probar-programado <idDelWorkflow> [minutosDeEspera]
 *
 * Solo toca el disparador, y solo mientras dura la prueba. Si el proceso muere a mitad, la
 * siguiente ejecución de `npm run n8n -- subir <archivo>` deja el workflow como está en el
 * repositorio, que es la fuente de verdad.
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

const id = process.argv[2]
const minutos = Math.min(Number(process.argv[3]) || 3, 10)
if (!id) { console.error('Uso: npm run n8n -- probar-programado <idDelWorkflow> [minutos]'); process.exit(2) }

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

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms))

const workflow = await api(`/workflows/${id}`)
const disparador = workflow.nodes.find((nodo) => nodo.type === 'n8n-nodes-base.scheduleTrigger')
if (!disparador) { console.error(`"${workflow.name}" no tiene disparador programado.`); process.exit(2) }

const original = JSON.parse(JSON.stringify(disparador.parameters))
const cuerpoBase = (nodes) => ({ name: workflow.name, nodes, connections: workflow.connections, settings: workflow.settings ?? {} })

const desde = new Date().toISOString()
console.log(`"${workflow.name}" — acelerando el disparador a cada minuto durante ${minutos} min…`)

try {
  disparador.parameters = { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } }
  await api(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(cuerpoBase(workflow.nodes)) })
  // Un workflow activo se reactiva solo al guardarlo; si estaba inactivo, se deja inactivo.
  if (workflow.active) await api(`/workflows/${id}/activate`, { method: 'POST' })

  let vistas = []
  for (let minuto = 0; minuto < minutos; minuto += 1) {
    await espera(60000)
    const { data } = await api(`/executions?limit=20&workflowId=${id}`)
    vistas = (data ?? []).filter((ejecucion) => ejecucion.startedAt > desde)
    console.log(`  minuto ${minuto + 1}: ${vistas.length} ejecución(es) nuevas`)
    if (vistas.length) break
  }

  if (!vistas.length) {
    console.log('\nNO se disparó. Revisa que el workflow esté activo y que guarde las ejecuciones correctas.')
    process.exitCode = 1
  } else {
    for (const ejecucion of vistas) {
      const dur = ejecucion.stoppedAt ? Date.parse(ejecucion.stoppedAt) - Date.parse(ejecucion.startedAt) : null
      console.log(`\n  ${ejecucion.id} · ${ejecucion.status} · ${dur ?? '—'} ms · ${ejecucion.startedAt}`)
    }
    console.log('\nSe disparó y corrió.')
  }
} finally {
  disparador.parameters = original
  await api(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(cuerpoBase(workflow.nodes)) })
  if (workflow.active) await api(`/workflows/${id}/activate`, { method: 'POST' })
  console.log('Disparador restaurado.')
}
