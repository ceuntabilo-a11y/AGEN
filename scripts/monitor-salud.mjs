/**
 * Comprobación de salud de lo que está desplegado. SOLO LECTURA.
 *
 * Consulta endpoints que no exponen datos de negocio ni los modifican, y escribe el resultado
 * en `monitor-salud.json` para que quede como evidencia del run. Sale con código 1 si algo
 * crítico está caído después de varios intentos, que es lo que hace fallar la monitorización y
 * abrir la incidencia. Un fallo aislado que se arregla solo no abre nada: queda anotado como
 * `seRecupero` en el informe.
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

/** Un chequeo crítico caído hace fallar la monitorización; uno informativo solo se registra. */
const COMPROBACIONES = [
  // `service` se comprueba a propósito: en una máquina con varias apps en el mismo puerto,
  // un /api/health que responde 200 puede ser de OTRO proyecto.
  { nombre: 'api', ruta: '/api/health', critico: true, espera: (cuerpo) => cuerpo?.ok === true && cuerpo?.service === 'agen' },
  { nombre: 'portada', ruta: '/', critico: true },
  { nombre: 'login', ruta: '/login', critico: false },
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

const informe = { momento: new Date().toISOString(), destino: base, intentosPorComprobacion: INTENTOS, comprobaciones: [] }
let hayFalloCritico = false

for (const comprobacion of COMPROBACIONES) {
  const { sano, intentos } = await comprobar(comprobacion)
  const ultimo = intentos[intentos.length - 1]
  informe.comprobaciones.push({
    nombre: comprobacion.nombre,
    ruta: comprobacion.ruta,
    critico: comprobacion.critico,
    sano,
    // Se recuperó sola: interesa saberlo, es la señal de un corte breve y no de una caída.
    seRecupero: sano && intentos.length > 1,
    httpEstado: ultimo.httpEstado,
    ms: ultimo.ms,
    intentos,
    detalle: ultimo.detalle,
  })
  if (!sano && comprobacion.critico) hayFalloCritico = true
  const sufijo = sano && intentos.length > 1 ? ` (se recuperó en el intento ${intentos.length})` : ''
  console.log(`${sano ? '  OK  ' : ' FALLA'} ${comprobacion.nombre} (${comprobacion.ruta}) → HTTP ${ultimo.httpEstado} en ${ultimo.ms} ms${sufijo}`)
}

// Configuración presente o ausente, sin revelar ningún valor.
informe.configuracion = {
  n8nApiUrl: Boolean(process.env.N8N_API_URL),
}

writeFileSync('monitor-salud.json', `${JSON.stringify(informe, null, 2)}\n`)
process.exit(hayFalloCritico ? 1 : 0)
