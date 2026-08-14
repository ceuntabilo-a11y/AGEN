#!/usr/bin/env node
/**
 * Migración de una sola vez: dos llamadas de contexto pasan a ser una.
 *
 * El workflow 01 pedía el contexto del turno en DOS peticiones a la app —`/api/agent/memory` y
 * `/api/agent/catalog`— que además corrían en secuencia y se juntaban con un nodo Merge. Medido
 * contra producción, entre las dos se iban 1,5–2,5 s de cada turno sin que ninguna dependiera
 * de la otra.
 *
 * `/api/agent/context` devuelve exactamente los mismos campos en una llamada, así que aquí se
 * sustituyen los tres nodos (`Cargar memoria`, `Cargar catálogo`, `Unir contexto`) por uno solo
 * y se rehacen las conexiones.
 *
 * Está en el repositorio y no escrito a mano en la shell porque es una transformación sobre un
 * JSON de 40 000 caracteres: hacerlo a mano es como se cuelan los cambios a medias. Es
 * idempotente — si ya está migrado, no toca nada — así que se puede volver a ejecutar sin
 * miedo.
 *
 *   node scripts/n8n-unir-contexto.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUTA = path.join(RAIZ, 'n8n-workflows', '01-agen-agent.json')
const workflow = JSON.parse(readFileSync(RUTA, 'utf8'))

const VIEJOS = ['Cargar memoria', 'Cargar catálogo', 'Unir contexto']
const NUEVO = 'Cargar contexto'

if (workflow.nodes.some((nodo) => nodo.name === NUEVO)) {
  console.log('Ya estaba migrado: no se toca nada.')
  process.exit(0)
}

const memoria = workflow.nodes.find((nodo) => nodo.name === 'Cargar memoria')
if (!memoria) { console.error('No encuentro el nodo "Cargar memoria".'); process.exit(2) }

// Se hereda todo lo que ya estaba afinado en el nodo anterior (reintentos, techo de tiempo,
// tolerancia a fallo) y solo cambia la URL y el cuerpo.
workflow.nodes = workflow.nodes.filter((nodo) => !VIEJOS.includes(nodo.name))
workflow.nodes.push({
  ...memoria,
  id: 'load-context',
  name: NUEVO,
  position: [-560, 0],
  parameters: {
    ...memoria.parameters,
    url: "={{$env.AGEN_APP_URL + '/api/agent/context'}}",
    body: "={{JSON.stringify({businessId: $('Entrada').first().json.body.businessId, phone: $('Entrada').first().json.body.phone})}}",
  },
})

for (const viejo of VIEJOS) delete workflow.connections[viejo]
workflow.connections['¿Responde este?'] = {
  main: [
    [{ node: NUEVO, type: 'main', index: 0 }],
    [{ node: 'Ya respondió otro', type: 'main', index: 0 }],
  ],
}
workflow.connections[NUEVO] = { main: [[{ node: 'Agente Agen', type: 'main', index: 0 }]] }

/*
 * La espera de agrupación baja de 3 s a 1,5 s.
 *
 * Está para juntar los mensajes que alguien manda seguidos ("hola" / "quiero hora" / "mañana")
 * y contestarlos de una vez. Eso se cumple igual con segundo y medio: lo que separa una ráfaga
 * de dos mensajes distintos son décimas, no segundos. Tres segundos era coste fijo en CADA
 * conversación, incluida la de quien manda un solo mensaje — que son casi todas.
 */
const esperar = workflow.nodes.find((nodo) => nodo.name === 'Esperar')
if (esperar) { esperar.parameters = { amount: 1.5, unit: 'seconds' } }

writeFileSync(RUTA, `${JSON.stringify(workflow, null, 2)}\n`)
console.log(`Migrado: ${VIEJOS.join(', ')} → ${NUEVO}. Espera de agrupación: 1,5 s.`)
console.log('Súbelo con: npm run n8n -- subir n8n-workflows/01-agen-agent.json')
