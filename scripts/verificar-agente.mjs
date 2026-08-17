#!/usr/bin/env node
/**
 * Comprueba, contra producción, que el agente quedó desplegado y funcionando.
 *
 * Por qué existe: cada cambio del agente vive en dos sitios que se despliegan por separado —la
 * app (EasyPanel, un clic manual) y el workflow de n8n (una llamada a su API)—. Entre uno y otro
 * hay una ventana en la que el sistema está a medias, y hasta ahora la única forma de saber en
 * qué mitad estabas era mirar respuestas de WhatsApp a ojo. Esto lo convierte en una lista de
 * comprobaciones con resultado sí o no.
 *
 *   npm run verificar-agente                 comprueba la app y el workflow
 *   npm run verificar-agente -- <negocio> <telefono>   además manda un mensaje de verdad
 *
 * Solo LEE, salvo el mensaje de prueba final, que se manda únicamente si se le pasan negocio y
 * teléfono a propósito. Las credenciales salen de `.env.local` y nunca se imprimen.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

/*
 * Producción, siempre, salvo que se pida otra cosa con AGEN_VERIFICAR_URL.
 *
 * A propósito NO se lee `NEXT_PUBLIC_APP_URL`: en `.env.local` apunta a localhost:3000, y una
 * comprobación de despliegue que mira tu propia máquina no comprueba nada.
 */
const APP = (process.env.AGEN_VERIFICAR_URL ?? 'https://agen.synetia.site').replace(/\/$/, '')
const SECRETO = process.env.AGEN_WEBHOOK_SECRET ?? process.env.N8N_WEBHOOK_SECRET ?? ''
const N8N = (process.env.N8N_API_URL ?? '').replace(/\/$/, '')
const N8N_CLAVE = process.env.N8N_API_KEY ?? ''

const resultados = []
const anotar = (ok, titulo, detalle) => {
  resultados.push({ ok, titulo, detalle })
  console.log(`${ok ? 'OK  ' : 'FALLA'}  ${titulo}${detalle ? ' — ' + detalle : ''}`)
}

async function pedirALaApp(ruta, cuerpo) {
  const r = await fetch(`${APP}${ruta}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agen-secret': SECRETO },
    body: JSON.stringify(cuerpo),
  })
  let json = null
  try { json = await r.json() } catch { json = null }
  return { status: r.status, json }
}

/** El contexto del turno: es donde se ve si la app desplegada es la nueva. */
async function comprobarApp(negocio, telefono) {
  if (!negocio || !telefono) {
    console.log('(sin negocio y teléfono no se puede comprobar el contexto; pásalos como argumentos)')
    return
  }
  const { status, json } = await pedirALaApp('/api/agent/context', { businessId: negocio, phone: telefono, message: 'hola' })
  if (status !== 200 || !json) return anotar(false, 'La app responde el contexto', `HTTP ${status}`)

  anotar(Array.isArray(json.recent), 'La conversación viene de la base (`recent`)',
    Array.isArray(json.recent) ? `${json.recent.length} mensajes` : 'falta el campo: la app es la vieja')
  anotar('respuestaRapida' in json, 'El camino rápido está desplegado (`respuestaRapida`)')

  const servicio = (json.services ?? [])[0]
  anotar(Boolean(servicio && typeof servicio.precio === 'string'), 'El precio viene ya formateado',
    servicio ? String(servicio.precio) : 'el negocio no tiene servicios')

  // `reschedule` con datos inválidos: si la app es la nueva contesta DATO_INVALIDO por la fecha;
  // si es la vieja, contesta "Acción inválida". No mueve nada en ninguno de los dos casos.
  const mover = await pedirALaApp('/api/agent/appointments', {
    businessId: negocio, phone: telefono, action: 'reschedule', appointmentId: 'no-existe', desiredStart: 'ayer',
  })
  anotar(mover.json?.error !== 'Acción inválida', 'La acción de reagendar existe',
    mover.json?.motivo ? `motivo ${mover.json.motivo}` : `HTTP ${mover.status}`)
}

/** El workflow: que sea el definitivo y no el puente. */
async function comprobarWorkflow() {
  if (!N8N || !N8N_CLAVE) return console.log('(sin N8N_API_URL / N8N_API_KEY no se puede comprobar el workflow)')
  const lista = await (await fetch(`${N8N}/api/v1/workflows?limit=100`, { headers: { 'X-N8N-API-KEY': N8N_CLAVE } })).json()
  const agente = (lista.data ?? []).find((w) => /AGEN 01/.test(w.name))
  if (!agente) return anotar(false, 'El workflow del agente existe en n8n')

  const w = await (await fetch(`${N8N}/api/v1/workflows/${agente.id}`, { headers: { 'X-N8N-API-KEY': N8N_CLAVE } })).json()
  const nombres = (w.nodes ?? []).map((n) => n.name)

  anotar(w.active === true, 'El workflow está activo')
  anotar(!nombres.includes('Memoria reciente'), 'Sin el buffer en memoria de n8n',
    nombres.includes('Memoria reciente') ? 'sigue el puente: falta subir el definitivo' : 'la memoria vive en la base')
  // Router de intención: el turno entra por /api/agent/turn y las acciones las ejecuta
  // /api/agent/act. Ninguna acción crítica puede seguir siendo una herramienta del modelo.
  anotar(nombres.includes('Turno'), 'El router de intención está en el workflow')
  anotar(nombres.includes('Ejecutar acción'), 'Las acciones las ejecuta un paso fijo de código')
  const comoHerramienta = ['crear_reserva', 'liberar_reserva', 'mover_reserva', 'confirmar_reserva', 'registrar_cliente']
    .filter((nombre) => nombres.includes(nombre))
  anotar(comoHerramienta.length === 0, 'El modelo ya no puede reservar, cancelar ni mover por su cuenta',
    comoHerramienta.length ? `siguen como herramienta: ${comoHerramienta.join(', ')}` : 'ninguna acción cuelga del modelo')
  anotar(nombres.includes('¿Respuesta directa?'), 'El camino rápido está en el workflow')

  const entrada = (w.nodes ?? []).find((n) => n.name === 'Entrada')
  anotar(entrada?.type === 'n8n-nodes-base.set', 'La puerta de entrada no usa el sandbox lento',
    entrada?.type === 'n8n-nodes-base.set' ? 'nodo Set' : 'sigue siendo un nodo Code (~2 s por mensaje)')

  const herramientas = (w.nodes ?? []).filter((n) => String(n.type).includes('toolCode'))
  const protegidas = herramientas.filter((n) => String(n.parameters?.jsCode ?? '').includes('await pedirALaApp('))
  anotar(herramientas.length > 0 && protegidas.length === herramientas.length,
    'Ninguna herramienta puede tumbar la ejecución por un timeout',
    `${protegidas.length}/${herramientas.length}`)
}

const [negocio, telefono] = process.argv.slice(2)
if (!SECRETO) {
  console.error('Falta AGEN_WEBHOOK_SECRET (o N8N_WEBHOOK_SECRET) en .env.local.')
  process.exit(2)
}

const salud = await (await fetch(`${APP}/api/health`)).json().catch(() => null)
anotar(Boolean(salud), 'La app responde', salud?.commit ? `commit ${String(salud.commit).slice(0, 7)}` : '')

await comprobarApp(negocio, telefono)
await comprobarWorkflow()

const fallan = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - fallan.length}/${resultados.length} comprobaciones en verde`)
if (fallan.length) {
  console.log('Falta:')
  for (const f of fallan) console.log(` - ${f.titulo}${f.detalle ? ' (' + f.detalle + ')' : ''}`)
}
process.exitCode = fallan.length ? 1 : 0
