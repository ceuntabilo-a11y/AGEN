/**
 * Construye `n8n-workflows/01-agen-agent.json` con el router de intención.
 *
 * Se genera con un script y no a mano por una razón concreta: los nodos que ya funcionaban en
 * producción (la puerta de entrada, el agrupado de mensajes, la herramienta `buscar_horarios`
 * con su preámbulo de 80 líneas) se COPIAN del respaldo del workflow vivo, letra por letra, en
 * vez de reescribirse. Cada corrección ganada contra un fallo real sigue exactamente donde
 * estaba.
 *
 *   node scripts/construir-workflow-router.mjs
 *
 * Lee:   n8n-workflows/respaldo/01-agen-agent.ANTES-DEL-ROUTER.json
 * Deja:  n8n-workflows/01-agen-agent.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGEN = path.join(RAIZ, 'n8n-workflows', 'respaldo', '01-agen-agent.ANTES-DEL-ROUTER.json')
const DESTINO = path.join(RAIZ, 'n8n-workflows', '01-agen-agent.json')

const viejo = JSON.parse(fs.readFileSync(ORIGEN, 'utf8'))
const nodoViejo = (nombre) => {
  const encontrado = viejo.nodes.find((item) => item.name === nombre)
  if (!encontrado) throw new Error(`No encuentro el nodo "${nombre}" en el respaldo`)
  return JSON.parse(JSON.stringify(encontrado))
}

const SECRETO = { name: 'x-agen-secret', value: '={{$env.AGEN_WEBHOOK_SECRET}}' }

const http = (id, nombre, ruta, cuerpo, extra = {}) => ({
  parameters: {
    method: 'POST',
    url: `={{$env.AGEN_APP_URL + '${ruta}'}}`,
    sendHeaders: true,
    headerParameters: { parameters: [SECRETO] },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: cuerpo,
    options: { timeout: extra.timeout ?? 20000, ...(extra.options ?? {}) },
  },
  id,
  name: nombre,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: extra.position ?? [0, 0],
  ...(extra.retryOnFail ? { retryOnFail: true, maxTries: extra.maxTries ?? 2, waitBetweenTries: 1000 } : {}),
  ...(extra.onError ? { onError: extra.onError } : {}),
  ...(extra.notes ? { notes: extra.notes } : {}),
})

const si = (id, nombre, izquierda, operador, posicion, derecha) => ({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{
        id: `${id}-cond`,
        leftValue: izquierda,
        rightValue: derecha ?? '',
        operator: operador,
      }],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
  id,
  name: nombre,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: posicion,
})

const IGUAL_A = { type: 'string', operation: 'equals' }
const NO_VACIO = { type: 'string', operation: 'notEmpty', singleValue: true }

const texto = (id, nombre, valor, posicion) => ({
  parameters: {
    assignments: {
      assignments: [
        { id: `${id}-out`, name: 'output', value: valor, type: 'string' },
        { id: `${id}-cod`, name: 'origenCodigo', value: '={{ true }}', type: 'boolean' },
      ],
    },
    options: {},
  },
  id,
  name: nombre,
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: posicion,
})

/**
 * Un modelo por rama. Las instrucciones NO viven acá: las manda `/api/agent/turn` en
 * `systemMessage`, que es código versionado y con pruebas. Así una rama se corrige editando
 * TypeScript, no arrastrando cajas.
 */
const agente = (id, nombre, posicion, nota) => ({
  parameters: {
    promptType: 'define',
    text: "={{ $('Turno').first().json.userMessage }}",
    options: { systemMessage: "={{ $('Turno').first().json.systemMessage }}" },
  },
  id,
  name: nombre,
  type: '@n8n/n8n-nodes-langchain.agent',
  typeVersion: 3.1,
  position: posicion,
  onError: 'continueRegularOutput',
  notes: nota,
})

/*
 * El modelo se elige por variable de entorno, no queda clavado en el lienzo.
 *
 * Cambiar de modelo es la decisión que más veces se quiere probar y la que más caro sale
 * equivocarse: un identificador que no existe devuelve 400 en CADA mensaje. Con `AGEN_AGENT_MODEL`
 * el dueño lo cambia en n8n y lo revierte en segundos, sin desplegar la app ni tocar el workflow.
 * Sin la variable, `gpt-4o`, que es el que está probado en producción.
 */
const modelo = (id, nombre, posicion) => ({
  parameters: { modelName: "={{ $env.AGEN_AGENT_MODEL || 'gpt-5.6-luna' }}", options: { timeout: 45000, maxRetries: 2 } },
  id,
  name: nombre,
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  typeVersion: 1.3,
  position: posicion,
  credentials: { openAiApi: { id: 'NR5LHarvu8v5FFu6', name: 'OpenAI Agen' } },
})

/* ─────────────────────────────── Nodos ─────────────────────────────── */

const entrada = nodoViejo('Entrada')

/*
 * La puerta de entrada ahora reconoce imágenes y notas de voz.
 *
 * Se toca lo mínimo del nodo que ya funcionaba: se añade `mediaType` y se acepta un mensaje
 * sin texto cuando trae multimedia (una foto sin pie de foto era descartada en silencio).
 * Todos los descartes anteriores —grupos, difusión, estados, mensajes propios, JID que no son
 * teléfonos— quedan exactamente igual.
 */
entrada.parameters.jsonOutput = entrada.parameters.jsonOutput
  .replace(
    "var fromMe = Boolean(key.fromMe);",
    "var mediaType = mensaje.imageMessage ? 'image' : (mensaje.audioMessage ? 'audio' : (mensaje.pttMessage ? 'audio' : null));\n  var fromMe = Boolean(key.fromMe);",
  )
  .replace(
    "&& String(message).trim().length > 0;",
    "&& (String(message).trim().length > 0 || Boolean(mediaType));",
  )
  .replace(
    "instance: body.instance || (raw.body && raw.body.instance) || 'Agen'",
    "instance: body.instance || (raw.body && raw.body.instance) || 'Agen',\n    mediaType: mediaType",
  )
const webhook = nodoViejo('Webhook')
const autorizar = nodoViejo('Autorizar webhook')
const rechazar = nodoViejo('Rechazar')
const puerta = nodoViejo('¿Se atiende?')
const ignorar = nodoViejo('Ignorar')
const marcarLeido = nodoViejo('Marcar leído')
const escribiendo = nodoViejo('Escribiendo…')
const registrar = nodoViejo('Registrar')
const esperar = nodoViejo('Esperar')
// La espera de agrupado sube de 0,6 s a 2,5 s: con 0,6 s dos mensajes seguidos de una persona
// entraban como conversaciones distintas y el agente saludaba tres veces seguidas (visto en
// producción el 2026-08-17, 16:26). Sigue muy por debajo de lo que tarda el modelo.
esperar.parameters = { ...esperar.parameters, amount: 2.5, unit: 'seconds' }
const agrupar = nodoViejo('Agrupar')
const respondeEste = nodoViejo('¿Responde este?')
const buscarHorarios = nodoViejo('buscar_horarios')

// La herramienta de horarios ya no necesita adivinar la zona: la app manda dia/hora/franja
// resueltos desde hace meses. Se quita la referencia al nodo `Cargar catálogo`, que no existe
// en este workflow y solo servía para que un try/catch la tragara (defecto D5).
buscarHorarios.parameters.jsCode = buscarHorarios.parameters.jsCode
  .replace(/\/\/ Día, hora y franja resueltos[\s\S]*?\n} catch \(e\) \{\}\n(?=return JSON)/, '')
buscarHorarios.position = [520, 360]

// D3: la rama "ya respondió otro" tiene que CONTESTARLE al webhook. Con responseMode
// "responseNode", un NoOp deja la petición de Evolution colgada hasta que expira.
const yaRespondio = {
  parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ grouped: true }) }}', options: {} },
  id: 'ya-respondio-otro',
  name: 'Ya respondió otro',
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.5,
  position: [420, 200],
  notes: 'Antes era un NoOp y la petición quedaba sin respuesta hasta el timeout (defecto D3).',
}

/*
 * Multimedia de Evolution: la URL que trae el webhook está cifrada por WhatsApp y no la puede
 * leer nadie de fuera. La forma correcta es pedirle el contenido a la propia Evolution y
 * pasarlo como data URI, que es lo que sí entienden Whisper y Vision.
 *
 * Va detrás de un IF para no gastar una llamada en los mensajes de texto, que son la mayoría,
 * y con `onError: continueRegularOutput` para que una imagen que no se pueda bajar no tumbe la
 * conversación: el turno sigue con el texto.
 */
const traeMultimedia = si('trae-multimedia', '¿Trae multimedia?', "={{ $('Entrada').first().json.mediaType }}", NO_VACIO, [-260, 0])

const bajarMultimedia = {
  parameters: {
    method: 'POST',
    url: "={{$env.EVOLUTION_API_URL + '/chat/getBase64FromMediaMessage/' + $('Entrada').first().json.instance}}",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'apikey', value: '={{$env.EVOLUTION_API_KEY}}' }] },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/json',
    body: "={{ JSON.stringify({ message: { key: $('Entrada').first().json.messageKey }, convertToMp4: false }) }}",
    options: { timeout: 20000 },
  },
  id: 'bajar-multimedia',
  name: 'Bajar multimedia',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [-160, -180],
  onError: 'continueRegularOutput',
  notes: 'La URL del webhook viene cifrada por WhatsApp: el contenido se pide a Evolution y viaja como data URI.',
}

const turno = http('turno', 'Turno', '/api/agent/turn',
  "={{ JSON.stringify({ businessId: $('Entrada').first().json.body.businessId, phone: $('Entrada').first().json.body.phone, message: String(($('Agrupar').first().json.message || $('Entrada').first().json.body.message) || '').slice(0, 2000), mediaType: $('Entrada').first().json.mediaType || null, mediaUrl: (function () { try { var m = $('Bajar multimedia').first().json; var b = (m && (m.base64 || (m.media && m.media.base64))) || null; if (!b) return null; var mime = (m.mimetype || (m.media && m.media.mimetype) || ($('Entrada').first().json.mediaType === 'audio' ? 'audio/ogg' : 'image/jpeg')); return 'data:' + mime + ';base64,' + b } catch (e) { return null } })() }) }}",
  {
    position: [-60, 0], timeout: 25000, retryOnFail: true, maxTries: 3,
    onError: 'continueRegularOutput',
    notes: 'Router de intención. Devuelve la rama, las instrucciones de esa rama y el contexto ya resuelto. Si falla, el nodo siguiente lo detecta y el turno NO sigue a ciegas (defecto D1).',
  })

// D1: sin `ruta` no hay contexto, y sin contexto el agente contestaría sin catálogo ni
// reservas. El turno se corta acá con un mensaje honesto en vez de continuar a ciegas.
const hayContexto = si('hay-contexto', '¿Hay contexto?', '={{ $json.ruta }}', NO_VACIO, [140, 0])
const falloContexto = texto('fallo-contexto', 'No pude consultar',
  'Perdona, ahora mismo no puedo consultar la agenda. ¿Puedes escribirme en unos minutos?',
  [340, -200])

const esDirecta = si('es-directa', '¿Respuesta directa?', '={{ $json.ruta }}', IGUAL_A, [340, 0], 'DIRECTA')
const directa = texto('respuesta-directa', 'Respuesta directa', '={{ $json.texto }}', [540, -80])

const esBuscar = si('es-buscar', '¿Busca horarios?', '={{ $json.ruta }}', IGUAL_A, [540, 120], 'BUSCAR')
const esDecidir = si('es-decidir', '¿Decide una acción?', '={{ $json.ruta }}', IGUAL_A, [740, 240], 'DECIDIR')

const buscador = agente('rama-buscar', 'Buscador', [760, 60],
  'Rama BUSCAR: la ÚNICA herramienta conectada es buscar_horarios. No puede reservar, mover ni cancelar.')
const redactor = agente('rama-info', 'Redactor', [960, 380],
  'Rama INFO: sin ninguna herramienta conectada. Solo puede hablar de lo que va en el contexto.')
const decisor = agente('rama-decidir', 'Decisor', [960, 180],
  'Rama DECIDIR: sin herramientas. Devuelve JSON con "confirmado"; quien ejecuta es /api/agent/act.')

const modeloBuscar = modelo('modelo-buscar', 'Modelo · buscar', [760, 240])
const modeloDecidir = modelo('modelo-decidir', 'Modelo · decidir', [960, 20])
const modeloInfo = modelo('modelo-info', 'Modelo · info', [960, 540])

// El ejecutor. Aquí ocurren las acciones, y solo si el JSON trae confirmado:true.
const ejecutar = http('ejecutar', 'Ejecutar acción', '/api/agent/act',
  "={{ JSON.stringify({ businessId: $('Entrada').first().json.body.businessId, phone: $('Entrada').first().json.body.phone, decision: String($json.output || '') }) }}",
  {
    position: [1160, 180], timeout: 25000, retryOnFail: true, maxTries: 2,
    notes: 'Paso fijo de código: valida el JSON del decisor contra la base y ejecuta. El texto que devuelve se construye con los datos guardados, no con lo que dijo el modelo.',
  })

const enviar = http('enviar-whatsapp', 'Enviar a WhatsApp', '/api/agent/reply',
  "={{ JSON.stringify({ businessId: $('Entrada').first().json.body.businessId, phone: $('Entrada').first().json.body.phone, instance: $('Entrada').first().json.instance, messageId: $('Entrada').first().json.messageId, reply: String($json.output || $json.text || ''), rama: $('Turno').first().json.ruta || null, origen: ($json.ejecutado !== undefined || $json.origenCodigo === true) ? 'CODIGO' : 'MODELO', imageUrl: $('Turno').first().json.imageUrl || null, wasAudio: $('Turno').first().json.wasAudio === true, actorType: $('Turno').first().json.intencion === 'EQUIPO' ? 'TEAM' : 'CLIENT' }) }}",
  { position: [1400, 100], timeout: 25000, retryOnFail: true, maxTries: 2 })

const persistir = nodoViejo('Persistir interacción')
persistir.parameters.body = "={{JSON.stringify({businessId: $('Entrada').first().json.body.businessId, phone: $('Entrada').first().json.body.phone, message: String(($('Agrupar').first().json.message || $('Entrada').first().json.body.message) || '').slice(0, 2000), reply: String($('Enviar a WhatsApp').first().json.text || '')})}}"
persistir.position = [1600, 100]

const responder = nodoViejo('Responder')
responder.position = [1780, 100]

/* ───────────────────────────── Conexiones ───────────────────────────── */

const principal = (destino, indice = 0) => ({ node: destino, type: 'main', index: indice })

const workflow = {
  name: viejo.name,
  nodes: [
    webhook, autorizar, rechazar, entrada, puerta, ignorar,
    marcarLeido, escribiendo, registrar, esperar, agrupar, respondeEste, yaRespondio,
    traeMultimedia, bajarMultimedia, turno, hayContexto, falloContexto, esDirecta, directa, esBuscar, esDecidir,
    buscador, decisor, redactor, modeloBuscar, modeloDecidir, modeloInfo,
    buscarHorarios, ejecutar, enviar, persistir, responder,
  ],
  connections: {
    Webhook: { main: [[principal('Autorizar webhook')]] },
    'Autorizar webhook': { main: [[principal('Entrada')], [principal('Rechazar')]] },
    Entrada: { main: [[principal('¿Se atiende?')]] },
    '¿Se atiende?': { main: [[principal('Marcar leído')], [principal('Ignorar')]] },
    'Marcar leído': { main: [[principal('Escribiendo…')]] },
    'Escribiendo…': { main: [[principal('Registrar')]] },
    Registrar: { main: [[principal('Esperar')]] },
    Esperar: { main: [[principal('Agrupar')]] },
    Agrupar: { main: [[principal('¿Responde este?')]] },
    '¿Responde este?': { main: [[principal('¿Trae multimedia?')], [principal('Ya respondió otro')]] },
    '¿Trae multimedia?': { main: [[principal('Bajar multimedia')], [principal('Turno')]] },
    'Bajar multimedia': { main: [[principal('Turno')]] },
    Turno: { main: [[principal('¿Hay contexto?')]] },
    '¿Hay contexto?': { main: [[principal('¿Respuesta directa?')], [principal('No pude consultar')]] },
    'No pude consultar': { main: [[principal('Enviar a WhatsApp')]] },
    '¿Respuesta directa?': { main: [[principal('Respuesta directa')], [principal('¿Busca horarios?')]] },
    'Respuesta directa': { main: [[principal('Enviar a WhatsApp')]] },
    '¿Busca horarios?': { main: [[principal('Buscador')], [principal('¿Decide una acción?')]] },
    '¿Decide una acción?': { main: [[principal('Decisor')], [principal('Redactor')]] },
    Buscador: { main: [[principal('Enviar a WhatsApp')]] },
    Decisor: { main: [[principal('Ejecutar acción')]] },
    Redactor: { main: [[principal('Enviar a WhatsApp')]] },
    'Ejecutar acción': { main: [[principal('Enviar a WhatsApp')]] },
    'Enviar a WhatsApp': { main: [[principal('Persistir interacción')]] },
    'Persistir interacción': { main: [[principal('Responder')]] },
    buscar_horarios: { ai_tool: [[{ node: 'Buscador', type: 'ai_tool', index: 0 }]] },
    'Modelo · buscar': { ai_languageModel: [[{ node: 'Buscador', type: 'ai_languageModel', index: 0 }]] },
    'Modelo · decidir': { ai_languageModel: [[{ node: 'Decisor', type: 'ai_languageModel', index: 0 }]] },
    'Modelo · info': { ai_languageModel: [[{ node: 'Redactor', type: 'ai_languageModel', index: 0 }]] },
  },
  pinData: {},
  /*
   * Solo los ajustes que acepta la API pública de n8n.
   *
   * El workflow exportado del servidor trae además `binaryMode`, que el panel guarda pero el
   * esquema de `PUT /workflows/{id}` rechaza con «settings must NOT have additional
   * properties». Copiar los ajustes tal cual hacía imposible subirlo.
   */
  settings: Object.fromEntries(
    Object.entries(viejo.settings ?? { executionOrder: 'v1' })
      .filter(([clave]) => ['executionOrder', 'saveManualExecutions', 'callerPolicy', 'timezone',
        'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveExecutionProgress',
        'executionTimeout', 'errorWorkflow'].includes(clave)),
  ),
  active: false,
  versionId: 'router-de-intencion-1',
  meta: { templateCredsSetupCompleted: false },
  tags: [],
}

fs.writeFileSync(DESTINO, `${JSON.stringify(workflow, null, 2)}\n`)
console.log(`Escrito ${path.relative(RAIZ, DESTINO)} con ${workflow.nodes.length} nodos.`)
