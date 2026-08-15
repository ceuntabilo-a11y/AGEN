#!/usr/bin/env node
/**
 * Migración de una sola vez: la herramienta `buscar_horarios` resuelve el día y la hora.
 *
 * El fallo, de una conversación real de producción: `service_start` viaja en UTC y el modelo
 * tiene que convertirlo a la zona del negocio para nombrarlo. Con horarios de las 09:00 locales
 * (13:00 UTC) le dijo al cliente **"el martes 17 de agosto a las 13:00"** — y el 17 era lunes, y
 * las 13:00 eran las 09:00. Ni el día, ni la hora, ni la franja. El cliente no tiene forma de
 * saberlo hasta que llega al local.
 *
 * Pedirle aritmética de husos a un modelo es pedirle que acierte casi siempre; se comprobó que
 * ni siquiera prohibiéndoselo en el prompt deja de hacerlo. La conversión se hace acá, en el
 * nodo, con `Intl` —que respeta el horario de verano— y el modelo solo copia.
 *
 * La app también lo devuelve ya resuelto desde `/api/agent/slots`, pero eso solo llega con el
 * siguiente despliegue: este nodo lo arregla hoy y sigue siendo correcto después, porque si los
 * campos ya vienen, no los toca.
 *
 * Idempotente: si ya está migrado, no toca nada.
 *
 *   node scripts/n8n-formatear-horarios.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUTA = path.join(RAIZ, 'n8n-workflows', '01-agen-agent.json')
const workflow = JSON.parse(readFileSync(RUTA, 'utf8'))

const nodo = workflow.nodes.find((item) => item.name === 'buscar_horarios')
if (!nodo) { console.error('No encuentro la herramienta "buscar_horarios".'); process.exit(2) }

const VIEJO = 'return JSON.stringify({ status: res.statusCode, body: res.body });'
if (!nodo.parameters.jsCode.includes(VIEJO)) {
  console.log('Ya estaba migrado (o el nodo cambió de forma): no se toca nada.')
  process.exit(0)
}

const NUEVO = [
  '// Día, hora y franja resueltos en la zona del NEGOCIO, para que el modelo solo copie.',
  '// Si la app ya los manda (despliegues nuevos), se respetan tal cual.',
  "let zona = 'America/Santiago';",
  'try {',
  "  const ctx = typeof $ === 'function' ? ($('Cargar contexto', 0, 'first') || null) : null;",
  '  if (ctx && ctx.json && ctx.json.business && ctx.json.business.timezone) zona = ctx.json.business.timezone;',
  '} catch (e) {}',
  'try {',
  "  if (zona === 'America/Santiago') {",
  "    const cat = $('Cargar catálogo').first();",
  '    if (cat && cat.json && cat.json.business && cat.json.business.timezone) zona = cat.json.business.timezone;',
  '  }',
  '} catch (e) {}',
  'try {',
  '  if (res.body && Array.isArray(res.body.slots)) {',
  '    if (res.body.zona) zona = res.body.zona;',
  '    res.body.slots = res.body.slots.map(function (s) {',
  '      if (s && s.hora && s.dia) return s;',
  '      const inicio = new Date(s.service_start);',
  "      const hora = new Intl.DateTimeFormat('es-CL', { timeZone: zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(inicio);",
  "      const dia = new Intl.DateTimeFormat('es-CL', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long' }).format(inicio);",
  "      const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(inicio);",
  "      return Object.assign({}, s, { hora: hora, dia: dia, fecha: fecha, franja: Number(hora.slice(0, 2)) < 13 ? 'mañana' : 'tarde' });",
  '    });',
  '  }',
  '} catch (e) {}',
  'return JSON.stringify({ status: res.statusCode, body: res.body });',
].join('\n')

nodo.parameters.jsCode = nodo.parameters.jsCode.replace(VIEJO, NUEVO)
writeFileSync(RUTA, `${JSON.stringify(workflow, null, 2)}\n`)
console.log('buscar_horarios ahora devuelve dia, hora, fecha y franja resueltos.')
