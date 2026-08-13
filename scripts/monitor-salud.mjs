/**
 * Comprobación de salud de lo que está desplegado. SOLO LECTURA.
 *
 * Consulta endpoints que no exponen datos de negocio ni los modifican, y escribe el resultado
 * en `monitor-salud.json` para que quede como evidencia del run. Sale con código 1 si algo
 * crítico está caído, que es lo que hace fallar la monitorización y abrir la incidencia.
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

const informe = { momento: new Date().toISOString(), destino: base, comprobaciones: [] }
let hayFalloCritico = false

for (const comprobacion of COMPROBACIONES) {
  const resultado = await consultar(comprobacion.ruta)
  const sano = resultado.ok && (comprobacion.espera ? comprobacion.espera(resultado.cuerpo) : true)
  informe.comprobaciones.push({
    nombre: comprobacion.nombre,
    ruta: comprobacion.ruta,
    critico: comprobacion.critico,
    sano,
    httpEstado: resultado.estado,
    ms: resultado.ms,
    detalle: resultado.error ?? (sano ? null : 'respuesta inesperada'),
  })
  if (!sano && comprobacion.critico) hayFalloCritico = true
  console.log(`${sano ? '  OK  ' : ' FALLA'} ${comprobacion.nombre} (${comprobacion.ruta}) → HTTP ${resultado.estado} en ${resultado.ms} ms`)
}

// Configuración presente o ausente, sin revelar ningún valor.
informe.configuracion = {
  n8nApiUrl: Boolean(process.env.N8N_API_URL),
}

writeFileSync('monitor-salud.json', `${JSON.stringify(informe, null, 2)}\n`)
process.exit(hayFalloCritico ? 1 : 0)
