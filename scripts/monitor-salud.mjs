/**
 * Comprobación de salud de lo que está desplegado. SOLO LECTURA.
 *
 * Consulta endpoints que no exponen datos de negocio ni los modifican, y escribe el resultado
 * en `monitor-salud.json` para que quede como evidencia del run. Sale con código 1 si algo
 * crítico está caído después de varios intentos, que es lo que hace fallar la monitorización y
 * abrir la incidencia. Un fallo aislado que se arregla solo no abre nada: queda anotado como
 * `seRecupero` en el informe.
 *
 * Mide además la latencia contra un presupuesto por ruta. Ir lento NO abre incidencia —una web
 * lenta sigue funcionando— pero queda marcado como `lento`, que es la señal que se ve ANTES de
 * la caída.
 *
 * Nunca imprime credenciales: de las variables de entorno solo se informa si están o no.
 *
 * Uso:
 *   node scripts/monitor-salud.mjs http://127.0.0.1:3000   (destino como argumento)
 *   node scripts/monitor-salud.mjs                          (destino en AGEN_APP_URL)
 *
 * El argumento existe para poder lanzarlo en local sin anteponer una variable de entorno al
 * comando: esa forma dispara un diálogo de permisos innecesario (ver `safe-local-autonomy`).
 */
import { writeFileSync } from 'node:fs'

const TIEMPO_LIMITE_MS = 15000

/**
 * Un chequeo crítico caído hace fallar la monitorización; uno informativo solo se registra.
 *
 * `presupuestoMs` es el techo de latencia aceptable para esa ruta. Superarlo NO hace fallar la
 * monitorización —una web lenta sigue funcionando y no se levanta a nadie de madrugada por
 * eso— pero queda marcado como `lento` en el informe. Sirve para ver la degradación antes de
 * la caída: /api/health tardando 4 s no es un corte todavía, pero avisa de que algo se está
 * yendo (la base saturada, el contenedor sin memoria, un despliegue a medias).
 *
 * Los números salen de lo que hace cada ruta: /api/health solo responde un JSON fijo, así que
 * medio segundo ya es mucho; la portada y el login renderizan página, así que se les da más.
 */
const COMPROBACIONES = [
  // `service` se comprueba a propósito: en una máquina con varias apps en el mismo puerto,
  // un /api/health que responde 200 puede ser de OTRO proyecto.
  { nombre: 'api', ruta: '/api/health', critico: true, presupuestoMs: 800, espera: (cuerpo) => cuerpo?.ok === true && cuerpo?.service === 'agen' },
  { nombre: 'portada', ruta: '/', critico: true, presupuestoMs: 2500 },
  { nombre: 'login', ruta: '/login', critico: false, presupuestoMs: 2500 },
]

const base = (process.argv[2] ?? process.env.AGEN_APP_URL ?? '').replace(/\/$/, '')
if (!base) {
  console.log('AGEN_APP_URL no está definida: no hay nada que vigilar.')
  process.exit(0)
}

const consultar = async (ruta) => {
  const arranque = Date.now()
  try {
    const respuesta = await fetch(`${base}${ruta}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    })
    const texto = await respuesta.text()
    let cuerpo = null
    try { cuerpo = JSON.parse(texto) } catch { cuerpo = null }
    return { estado: respuesta.status, ok: respuesta.ok, ms: Date.now() - arranque, cuerpo }
  } catch (error) {
    return { estado: 0, ok: false, ms: Date.now() - arranque, error: error?.name ?? 'error' }
  }
}

/**
 * Reintentos antes de dar algo por caído.
 *
 * Un despliegue, un reinicio del contenedor o un microcorte de red producen un fallo aislado
 * que se arregla solo en segundos. Sin reintentos, cada uno de esos abría una incidencia que
 * al mirarla ya estaba sana — y una alarma que casi siempre es falsa deja de mirarse.
 * Se reintenta solo lo que falla, con espera creciente.
 */
const INTENTOS = 3
const ESPERA_ENTRE_INTENTOS_MS = 5000

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms))

async function comprobar(comprobacion) {
  const intentos = []
  for (let intento = 1; intento <= INTENTOS; intento += 1) {
    const resultado = await consultar(comprobacion.ruta)
    const sano = resultado.ok && (comprobacion.espera ? comprobacion.espera(resultado.cuerpo) : true)
    intentos.push({ intento, sano, httpEstado: resultado.estado, ms: resultado.ms, detalle: resultado.error ?? (sano ? null : 'respuesta inesperada') })
    if (sano) return { sano, intentos, ultimo: resultado }
    if (intento < INTENTOS) await espera(ESPERA_ENTRE_INTENTOS_MS * intento)
  }
  return { sano: false, intentos, ultimo: null }
}

/**
 * Una petición de calentamiento antes de medir, y no se cuenta.
 *
 * Por qué: el monitor arranca un proceso nuevo cada media hora, así que su PRIMERA petición
 * paga resolución DNS, apretón TCP y apretón TLS contra un destino que nunca ha visto.
 * Perfilando producción, esa primera petición se iba a 2556 ms de los cuales 811 eran DNS y
 * 261 TLS, mientras la ruta en sí (medida en local contra el mismo build) tarda 4 ms de
 * mediana. Es decir: se estaba marcando como "lento" el coste de abrir la conexión, no la
 * salud de la aplicación — y una señal que apunta al sitio equivocado es peor que no tenerla.
 *
 * El calentamiento se registra igual en el informe (`msConexionFria`), porque sí interesa
 * saber si el camino hasta producción se degrada; simplemente no es lo que decide "lento".
 */
const calentamiento = await consultar(COMPROBACIONES[0].ruta)

const informe = {
  momento: new Date().toISOString(),
  destino: base,
  intentosPorComprobacion: INTENTOS,
  msConexionFria: calentamiento.ms,
  comprobaciones: [],
}
console.log(`(conexión fría: ${calentamiento.ms} ms — DNS + TLS + primer viaje, no cuenta para el presupuesto)`)
let hayFalloCritico = false
let hayLentitud = false

for (const comprobacion of COMPROBACIONES) {
  const { sano, intentos, ultimo: respuesta } = await comprobar(comprobacion)
  const ultimo = intentos[intentos.length - 1]
  // Qué versión está viva. Sin esto no se distingue "el arreglo está desplegado" de "el
  // arreglo está en main y producción sigue con el código anterior" (el despliegue es manual).
  if (comprobacion.nombre === 'api' && respuesta?.cuerpo?.commit) {
    informe.commitDesplegado = respuesta.cuerpo.commit
    console.log(`  commit vivo en el destino: ${respuesta.cuerpo.commitCorto ?? respuesta.cuerpo.commit}`)
  }
  const lento = sano && ultimo.ms > comprobacion.presupuestoMs
  informe.comprobaciones.push({
    nombre: comprobacion.nombre,
    ruta: comprobacion.ruta,
    critico: comprobacion.critico,
    sano,
    // Se recuperó sola: interesa saberlo, es la señal de un corte breve y no de una caída.
    seRecupero: sano && intentos.length > 1,
    lento,
    presupuestoMs: comprobacion.presupuestoMs,
    httpEstado: ultimo.httpEstado,
    ms: ultimo.ms,
    intentos,
    detalle: ultimo.detalle,
  })
  if (!sano && comprobacion.critico) hayFalloCritico = true
  if (lento) hayLentitud = true
  const sufijo = sano && intentos.length > 1 ? ` (se recuperó en el intento ${intentos.length})` : ''
  const marca = !sano ? ' FALLA' : lento ? ' LENTO' : '  OK  '
  const presupuesto = lento ? ` — presupuesto ${comprobacion.presupuestoMs} ms` : ''
  console.log(`${marca} ${comprobacion.nombre} (${comprobacion.ruta}) → HTTP ${ultimo.httpEstado} en ${ultimo.ms} ms${presupuesto}${sufijo}`)
}

informe.lentitud = hayLentitud
if (hayLentitud && !hayFalloCritico) {
  console.log('\nTodo responde, pero alguna ruta va por encima de su presupuesto de latencia.')
  console.log('No se abre incidencia por esto: es degradación, no caída. Queda en monitor-salud.json.')
}

// Configuración presente o ausente, sin revelar ningún valor.
informe.configuracion = {
  n8nApiUrl: Boolean(process.env.N8N_API_URL),
}

writeFileSync('monitor-salud.json', `${JSON.stringify(informe, null, 2)}\n`)

/*
 * `process.exitCode` en vez de `process.exit()`.
 *
 * `fetch` deja el pool de conexiones de undici vivo unos segundos. Cortar el proceso a la
 * fuerza con esos sockets abiertos hace que libuv aborte en Windows:
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
 * y entonces el monitor sale con 127 aunque todo esté sano — es decir, abre una incidencia
 * falsa cada media hora. Con `exitCode` el proceso termina por su cuenta al cerrarse los
 * sockets, conservando el código de salida.
 */
process.exitCode = hayFalloCritico ? 1 : 0
