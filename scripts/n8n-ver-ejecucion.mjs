#!/usr/bin/env node
/**
 * Qué le contestó el agente al cliente en una ejecución, y qué le respondió cada herramienta.
 *
 * `npm run n8n -- ejecucion <id>` da los tiempos; esto da el CONTENIDO, que es lo que hace
 * falta para saber si la conversación fue bien: el texto entregado, si se envió de verdad, si
 * la revisión lo bloqueó, y el resultado de cada herramienta con sus argumentos.
 *
 *   npm run n8n -- dijo <idDeEjecucion>
 *
 * Solo lectura. No imprime cabeceras (ahí viaja el secreto compartido).
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
if (!id) { console.error('Uso: npm run n8n -- dijo <idDeEjecucion>'); process.exit(2) }

const respuesta = await fetch(`${BASE}/api/v1/executions/${id}?includeData=true`, {
  headers: { 'X-N8N-API-KEY': CLAVE },
  signal: AbortSignal.timeout(60000),
})
if (!respuesta.ok) { console.error(`n8n respondió ${respuesta.status}`); process.exit(1) }
const ejecucion = await respuesta.json()
const corridas = ejecucion?.data?.resultData?.runData ?? {}

const recortar = (valor, largo = 700) => {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor)
  return texto && texto.length > largo ? `${texto.slice(0, largo)}…` : texto
}

console.log(`Ejecución ${ejecucion.id} · ${ejecucion.status} · ${ejecucion.startedAt}`)

const entrada = corridas.Entrada?.[0]?.data?.main?.[0]?.[0]?.json?.body
if (entrada) console.log(`\nCLIENTE DIJO: ${recortar(entrada.message)}`)

for (const [nombre, ejecuciones] of Object.entries(corridas)) {
  for (const corrida of ejecuciones) {
    const herramienta = corrida?.data?.ai_tool?.[0]?.[0]?.json
    if (!herramienta) continue
    const argumentos = corrida?.inputOverride?.ai_tool?.[0]?.[0]?.json
    console.log(`\nHERRAMIENTA ${nombre}`)
    console.log(`  pidió:   ${recortar(argumentos, 400)}`)
    console.log(`  obtuvo:  ${recortar(herramienta.response ?? herramienta, 500)}`)
  }
}

const envio = corridas['Enviar a WhatsApp']?.[0]?.data?.main?.[0]?.[0]?.json
if (envio) {
  console.log(`\nAGENTE RESPONDIÓ (entregado: ${envio.sent === true ? 'sí' : 'NO'}${envio.blocked ? ', BLOQUEADO por la revisión' : ''}):`)
  console.log(recortar(envio.text, 1500))
  if (envio.reasons?.length) console.log(`motivos de la revisión: ${envio.reasons.join(', ')}`)
} else {
  // Con el router hay una rama por intención: se mira la que corrió.
  const rama = ['Respuesta directa', 'Buscador', 'Redactor', 'Decisor', 'Ejecutar acción', 'No pude consultar']
    .find((nombre) => corridas[nombre]?.[0])
  const json = rama ? corridas[rama][0]?.data?.main?.[0]?.[0]?.json : null
  const salida = json?.output ?? json?.text ?? json?.texto
  console.log(`\nAGENTE RESPONDIÓ (rama ${rama ?? 'desconocida'}, sin llegar al envío):\n${recortar(salida, 1500) ?? '(nada)'}`)
}

const turno = corridas['Turno']?.[0]?.data?.main?.[0]?.[0]?.json
if (turno?.ruta) console.log(`\nRUTA DEL TURNO: ${turno.ruta} · intención ${turno.intencion} · ${JSON.stringify(turno.diagnostico ?? {})}`)
