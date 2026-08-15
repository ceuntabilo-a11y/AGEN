#!/usr/bin/env node
/**
 * Administración del n8n real desde el repositorio, sin que nadie tenga que abrir el panel.
 *
 * Es lo que exige `CLAUDE.md` §9.1: los workflows los sube, prueba y activa Claude por la API
 * REST de n8n; el usuario no entra a importar nada a mano. Y como todo lo demás
 * (`npm run gh`, `npm run app`), pasa por una envoltura con argumentos simples para que no
 * haga falta escribir URLs, cabeceras ni tuberías en la shell.
 *
 *   npm run n8n -- lista                       workflows, con id, nombre y si están activos
 *   npm run n8n -- ver <id>                    nodos y conexiones de un workflow
 *   npm run n8n -- exportar <id> <archivo>     lo guarda en disco tal cual está en el servidor
 *   npm run n8n -- subir <archivo.json> [id]   sube el JSON del repositorio al workflow
 *   npm run n8n -- activar <id>                lo activa
 *   npm run n8n -- desactivar <id>             lo desactiva
 *   npm run n8n -- ejecuciones [id] [n]        últimas ejecuciones, con estado y duración
 *   npm run n8n -- ejecucion <id>              DESGLOSE POR NODO: dónde se van los segundos
 *   npm run n8n -- lento <id> [n]              el desglose de las N ejecuciones más lentas
 *
 * Credenciales: `N8N_API_URL` y `N8N_API_KEY` salen de `.env.local`, que este script lee con
 * `process.loadEnvFile()`. Nunca se imprimen, ni se pasan por la línea de comandos.
 *
 * Qué NO hace: borrar workflows, borrar ejecuciones ni tocar credenciales. No hay orden para
 * eso, así que no se puede pedir por argumento.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const BASE = (process.env.N8N_API_URL ?? '').replace(/\/$/, '')
const CLAVE = process.env.N8N_API_KEY ?? ''
if (!BASE || !CLAVE) {
  console.error('Faltan N8N_API_URL y/o N8N_API_KEY en .env.local.')
  console.error('Cómo generarlas: CLAUDE.md §9.1 (n8n → Settings → n8n API → Create an API key).')
  process.exit(2)
}

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`${BASE}/api/v1${ruta}`, {
    ...opciones,
    headers: { 'X-N8N-API-KEY': CLAVE, 'content-type': 'application/json', ...(opciones.headers ?? {}) },
    signal: AbortSignal.timeout(60000),
  })
  const texto = await respuesta.text()
  let cuerpo = null
  try { cuerpo = JSON.parse(texto) } catch { cuerpo = null }
  if (!respuesta.ok) {
    console.error(`n8n respondió ${respuesta.status}: ${(cuerpo?.message ?? texto).slice(0, 400)}`)
    process.exit(1)
  }
  return cuerpo
}

const ms = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`)

/**
 * Duración de cada nodo de una ejecución.
 *
 * Esto es lo que contesta "¿dónde se van los 8 minutos?" sin añadir una línea de código a la
 * aplicación: n8n ya guarda `startTime` y `executionTime` de cada nodo en los datos de la
 * ejecución. Se ordena por duración descendente porque lo único que importa es el culpable.
 */
function desglose(ejecucion) {
  const corridas = ejecucion?.data?.resultData?.runData ?? {}
  const filas = []
  for (const [nodo, ejecuciones] of Object.entries(corridas)) {
    for (const corrida of ejecuciones) {
      filas.push({
        nodo,
        ms: corrida.executionTime ?? 0,
        inicio: corrida.startTime ?? 0,
        error: corrida.error?.message ?? null,
      })
    }
  }
  return filas
}

function imprimirDesglose(ejecucion) {
  const filas = desglose(ejecucion)
  if (!filas.length) { console.log('  (la ejecución no guardó datos por nodo)'); return }
  const primero = Math.min(...filas.map((f) => f.inicio))
  const ultimo = Math.max(...filas.map((f) => f.inicio + f.ms))
  const total = ultimo - primero
  console.log(`  total ${ms(total)} · ${filas.length} pasos`)
  for (const fila of [...filas].sort((a, b) => b.ms - a.ms)) {
    const parte = total ? Math.round((fila.ms / total) * 100) : 0
    const desde = ms(fila.inicio - primero)
    console.log(`   ${String(parte).padStart(3)}%  ${ms(fila.ms).padStart(8)}  +${desde.padStart(8)}  ${fila.nodo}${fila.error ? `  ERROR: ${fila.error}` : ''}`)
  }
}

const [orden, ...resto] = process.argv.slice(2)

switch (orden) {
  case 'lista': {
    const { data } = await api('/workflows?limit=100')
    for (const w of data) console.log(`${w.id}\t${w.active ? 'ACTIVO  ' : 'inactivo'}\t${w.name}`)
    break
  }

  case 'ver': {
    const w = await api(`/workflows/${resto[0]}`)
    console.log(`${w.name} (${w.id}) — ${w.active ? 'activo' : 'inactivo'} — ${w.nodes.length} nodos`)
    for (const n of w.nodes) {
      console.log(`  ${n.type.replace('n8n-nodes-base.', '').replace('@n8n/n8n-nodes-langchain.', '')}\t${n.name}`)
    }
    break
  }

  case 'exportar': {
    const [id, destino] = resto
    if (!id || !destino) { console.error('Uso: exportar <id> <archivo.json>'); process.exit(2) }
    const w = await api(`/workflows/${id}`)
    writeFileSync(path.resolve(RAIZ, destino), `${JSON.stringify(w, null, 2)}\n`)
    console.log(`${w.name} guardado en ${destino}`)
    break
  }

  case 'subir': {
    const [archivo, idExplicito] = resto
    if (!archivo) { console.error('Uso: subir <archivo.json> [id]'); process.exit(2) }
    const local = JSON.parse(readFileSync(path.resolve(RAIZ, archivo), 'utf8'))

    // Sin id se busca por nombre: así `subir n8n-workflows/01-agen-agent.json` actualiza el
    // que ya existe en vez de crear un duplicado, que es el error clásico al importar a mano.
    let id = idExplicito
    if (!id) {
      const { data } = await api('/workflows?limit=100')
      const igual = data.find((w) => w.name === local.name)
      if (!igual) { console.error(`No hay ningún workflow llamado "${local.name}". Pasa el id.`); process.exit(2) }
      id = igual.id
    }

    /*
     * Un workflow no puede llamar a una ruta que todavía no está desplegada.
     *
     * El despliegue de la app es un clic manual en EasyPanel y el workflow se sube por API:
     * nada impide subir primero el workflow y dejar al agente llamando a un 404, que en
     * producción significa clientes sin respuesta. Así que antes de subir se comprueba que
     * las rutas nuevas que el JSON menciona existen de verdad ahí fuera.
     *
     * La sonda es un GET a una ruta que solo exporta POST: 405 = existe, 404 = no existe. No
     * manda datos ni credenciales.
     */
    const RUTAS_NUEVAS = ['/api/agent/context', '/api/agent/escalate']
    const texto = JSON.stringify(local)
    const mencionadas = RUTAS_NUEVAS.filter((ruta) => texto.includes(ruta))
    for (const ruta of mencionadas) {
      let estado = 0
      try {
        const sonda = await fetch(`https://agen.synetia.site${ruta}`, { method: 'GET', signal: AbortSignal.timeout(10000) })
        estado = sonda.status
      } catch { estado = 0 }
      if (estado === 404) {
        console.error(`El workflow llama a ${ruta}, que NO existe en producción (HTTP 404).`)
        console.error('Subirlo ahora dejaría al agente llamando a una ruta inexistente.')
        console.error('Despliega primero la app en EasyPanel y vuelve a intentarlo.')
        process.exit(1)
      }
      if (estado === 0) {
        console.error(`No pude comprobar si ${ruta} existe en producción. No se sube a ciegas.`)
        process.exit(1)
      }
      console.log(`comprobado: ${ruta} existe en producción (HTTP ${estado})`)
    }

    // La API solo acepta estos campos en PUT; mandar `active`, `id` o `tags` da 400.
    const cuerpo = {
      name: local.name,
      nodes: local.nodes,
      connections: local.connections,
      settings: local.settings ?? {},
    }
    if (local.staticData) cuerpo.staticData = local.staticData
    const actualizado = await api(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
    console.log(`Actualizado ${actualizado.name} (${actualizado.id}) — ${actualizado.nodes.length} nodos`)
    console.log(actualizado.active ? 'Sigue activo.' : 'Está inactivo: actívalo cuando lo hayas probado.')
    break
  }

  case 'activar': {
    const w = await api(`/workflows/${resto[0]}/activate`, { method: 'POST' })
    console.log(`${w.name}: ${w.active ? 'activo' : 'sigue inactivo'}`)
    break
  }

  case 'desactivar': {
    const w = await api(`/workflows/${resto[0]}/deactivate`, { method: 'POST' })
    console.log(`${w.name}: ${w.active ? 'sigue activo' : 'desactivado'}`)
    break
  }

  case 'ejecuciones': {
    const id = resto[0]
    const limite = Math.min(Number(resto[1]) || 15, 100)
    const { data } = await api(`/executions?limit=${limite}${id ? `&workflowId=${id}` : ''}`)
    for (const e of data) {
      const dur = e.startedAt && e.stoppedAt ? Date.parse(e.stoppedAt) - Date.parse(e.startedAt) : null
      console.log(`${e.id}\t${e.status}\t${dur === null ? '—' : ms(dur).padStart(8)}\t${e.startedAt}\t${e.workflowId}`)
    }
    break
  }

  case 'ejecucion': {
    const e = await api(`/executions/${resto[0]}?includeData=true`)
    const dur = e.startedAt && e.stoppedAt ? Date.parse(e.stoppedAt) - Date.parse(e.startedAt) : null
    console.log(`Ejecución ${e.id} · ${e.status} · ${dur === null ? 'sin cerrar' : ms(dur)} · ${e.startedAt}`)
    imprimirDesglose(e)
    break
  }

  case 'lento': {
    const id = resto[0]
    const cuantas = Math.min(Number(resto[1]) || 3, 10)
    const { data } = await api(`/executions?limit=50${id ? `&workflowId=${id}` : ''}`)
    const conDuracion = data
      .filter((e) => e.startedAt && e.stoppedAt)
      .map((e) => ({ id: e.id, status: e.status, ms: Date.parse(e.stoppedAt) - Date.parse(e.startedAt), cuando: e.startedAt }))
      .sort((a, b) => b.ms - a.ms)
    if (!conDuracion.length) { console.log('No hay ejecuciones registradas.'); break }
    const mediana = [...conDuracion].sort((a, b) => a.ms - b.ms)[Math.floor(conDuracion.length / 2)].ms
    console.log(`${conDuracion.length} ejecuciones · mediana ${ms(mediana)} · más lenta ${ms(conDuracion[0].ms)}\n`)
    for (const item of conDuracion.slice(0, cuantas)) {
      console.log(`Ejecución ${item.id} · ${item.status} · ${ms(item.ms)} · ${item.cuando}`)
      const completa = await api(`/executions/${item.id}?includeData=true`)
      imprimirDesglose(completa)
      console.log('')
    }
    break
  }

  case 'herramienta': {
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-subir-herramienta.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'prompt': {
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-subir-prompt.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'medir-prompt': {
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-medir-prompt.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'probar-programado': {
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-probar-programado.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'crudo': {
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-ver-crudo.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'dijo': {
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-ver-ejecucion.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'herramientas': {
    // Delegado a su propio script para poder importarlo desde las pruebas sin ejecutar nada.
    const { spawnSync } = await import('node:child_process')
    const resultado = spawnSync(process.execPath, [path.join(RAIZ, 'scripts', 'n8n-herramientas.mjs'), ...resto], {
      cwd: RAIZ, stdio: 'inherit',
    })
    process.exitCode = resultado.status ?? 1
    break
  }

  case 'probar': {
    /*
     * Un mensaje de cliente de verdad, de punta a punta, y su desglose de latencia.
     *
     * Por qué hace falta: en las 100 ejecuciones más recientes del workflow 01 (siete horas
     * seguidas), CERO llegaron al agente — todas eran mensajes de grupos de WhatsApp, que la
     * puerta de entrada ignora a propósito. Sin una conversación atendida no hay nada que
     * medir, y "el agente tarda 8 minutos" no se puede ni confirmar ni arreglar a ciegas.
     *
     * El `Entrada` del workflow respeta un cuerpo ya normalizado (está puesto ahí para
     * pruebas), así que esto entra por la misma puerta que Evolution, con el mismo secreto y
     * recorriendo exactamente los mismos nodos.
     *
     * El secreto: de `.env.local` si está; si no, del que la propia n8n registró en la última
     * ejecución de este webhook — un dato que la API le devuelve a quien ya administra la
     * instancia. Nunca se imprime, ni se escribe en disco, ni se pasa por la línea de comandos.
     */
    const sueltos = resto.filter((valor) => !valor.startsWith('--'))
    const [businessId, mensaje, telefono] = sueltos
    /*
     * `--id <valor>` fija el identificador del mensaje, que normalmente es único por prueba.
     *
     * Sirve para lo único que no se puede provocar de otra forma: **el mismo evento entregado
     * dos veces**, que es lo que hace Evolution cuando un reintento se cruza con la respuesta.
     * Mandarlo dos veces con el mismo id tiene que producir UNA sola contestación.
     */
    const idFijado = resto.includes('--id') ? resto[resto.indexOf('--id') + 1] : null
    if (!businessId || !mensaje) {
      console.error('Uso: npm run n8n -- probar <businessId> "<mensaje>" [telefono] [--id <messageId>]')
      process.exit(2)
    }

    const { data: workflows } = await api('/workflows?limit=100')
    const agente = workflows.find((w) => w.name.startsWith('AGEN 01'))
    if (!agente) { console.error('No encuentro el workflow "AGEN 01".'); process.exit(1) }
    const completo = await api(`/workflows/${agente.id}`)
    const webhook = completo.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')
    if (!webhook) { console.error('El workflow 01 no tiene nodo Webhook.'); process.exit(1) }

    let secreto = process.env.AGEN_WEBHOOK_SECRET ?? ''
    if (!secreto) {
      const { data: previas } = await api(`/executions?limit=20&workflowId=${agente.id}`)
      for (const previa of previas) {
        const detalle = await api(`/executions/${previa.id}?includeData=true`)
        const cabeceras = detalle?.data?.resultData?.runData?.Webhook?.[0]?.data?.main?.[0]?.[0]?.json?.headers
        if (cabeceras?.['x-agen-secret']) { secreto = cabeceras['x-agen-secret']; break }
      }
    }
    if (!secreto) {
      console.error('No hay secreto disponible: define AGEN_WEBHOOK_SECRET en .env.local.')
      process.exit(2)
    }

    const url = `${BASE}/webhook/${webhook.parameters.path}?businessId=${encodeURIComponent(businessId)}`
    const cuerpo = {
      businessId,
      phone: telefono || '+56900000001',
      message: mensaje,
      sender: 'Prueba de latencia',
      messageId: idFijado || `prueba-${Date.now()}`,
      instance: 'Agen',
    }
    const arranque = Date.now()
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agen-secret': secreto },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(600000),
    })
    const texto = await respuesta.text()
    const total = Date.now() - arranque
    console.log(`webhook → HTTP ${respuesta.status} en ${ms(total)}`)
    console.log(texto.slice(0, 1000))

    // La ejecución tarda un instante en cerrarse tras responder al webhook.
    await new Promise((listo) => setTimeout(listo, 3000))
    const { data: ultimas } = await api(`/executions?limit=3&workflowId=${agente.id}`)
    if (ultimas?.[0]) {
      const detalle = await api(`/executions/${ultimas[0].id}?includeData=true`)
      const dur = detalle.startedAt && detalle.stoppedAt ? Date.parse(detalle.stoppedAt) - Date.parse(detalle.startedAt) : null
      console.log(`\nEjecución ${detalle.id} · ${detalle.status} · ${dur === null ? 'sin cerrar' : ms(dur)}`)
      imprimirDesglose(detalle)
    }
    break
  }

  default:
    console.log('Órdenes: lista · ver · exportar · subir · activar · desactivar · ejecuciones · ejecucion · lento · herramientas · probar')
    console.log('Ejemplo: npm run n8n -- lento <idDelWorkflow01> 3')
    process.exitCode = orden ? 2 : 0
}
