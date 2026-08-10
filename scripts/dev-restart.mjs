/**
 * Reinicia el servidor de desarrollo de AGEN y nada más.
 *
 * Existe para no tener que autorizar PowerShell ni Stop-Process de forma general: el alcance
 * está grabado en este archivo y no se puede ampliar por argumentos.
 *
 * Solo detiene procesos node.exe cuya línea de comando apunte a ESTE repositorio y a Next.
 * Cualquier otro proceso —incluido el servidor de MediCore, que corre en la misma máquina—
 * queda fuera por construcción.
 *
 *   node scripts/dev-restart.mjs          reinicia y espera a que /api/health responda
 *   node scripts/dev-restart.mjs --estado solo informa, no toca nada
 */
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SALUD = 'http://localhost:3000/api/health'
const LOG = path.join(RAIZ, '.next', 'dev-restart.log')
const soloEstado = process.argv.includes('--estado')

/** Procesos de Next que pertenecen a este repositorio. Nunca devuelve nada de fuera. */
function procesosDeAgen() {
  const consulta = [
    '-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
  ]
  let salida = ''
  try {
    salida = execFileSync('powershell', consulta, { encoding: 'utf8', windowsHide: true })
  } catch {
    return []
  }
  let filas
  try {
    filas = JSON.parse(salida || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(filas)) filas = [filas]

  const raizNormalizada = RAIZ.replace(/\\/g, '/').toLowerCase()
  return filas
    .filter((fila) => {
      const linea = String(fila?.CommandLine ?? '').replace(/\\/g, '/').toLowerCase()
      if (!linea) return false
      // Doble condición: tiene que ser de esta carpeta Y ser Next.
      if (!linea.includes(raizNormalizada)) return false
      if (!linea.includes('next')) return false
      // Cinturón extra: jamás tocar MediCore, que vive en la misma máquina.
      if (linea.includes('medicore')) return false
      return true
    })
    .map((fila) => Number(fila.ProcessId))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

async function salud(intentos = 1, esperaMs = 0) {
  for (let intento = 0; intento < intentos; intento++) {
    try {
      const respuesta = await fetch(SALUD, { signal: AbortSignal.timeout(4000) })
      if (respuesta.ok) return respuesta.status
    } catch {}
    if (esperaMs) await new Promise((listo) => setTimeout(listo, esperaMs))
  }
  return null
}

const encontrados = procesosDeAgen()
console.log(`procesos de AGEN/Next encontrados: ${encontrados.length ? encontrados.join(', ') : 'ninguno'}`)

if (soloEstado) {
  console.log(`health: ${(await salud()) ?? 'sin respuesta'}`)
} else {

  for (const pid of encontrados) {
    try {
      process.kill(pid)
      console.log(`detenido ${pid}`)
    } catch (error) {
      console.log(`no se pudo detener ${pid}: ${error.code ?? 'error'}`)
    }
  }

  mkdirSync(path.dirname(LOG), { recursive: true })
  const registro = openSync(LOG, 'a')
  // Comando en una sola cadena: pasar argumentos sueltos con shell:true provoca DEP0190.
  const hijo = spawn('npm run dev', {
    cwd: RAIZ,
    detached: true,
    stdio: ['ignore', registro, registro],
    shell: true,
  })
  hijo.unref()
  console.log(`npm run dev lanzado (pid ${hijo.pid}), log en ${LOG}`)

  const estado = await salud(40, 2000)
  console.log(`health: ${estado ?? 'sin respuesta tras 80s'}`)
  closeSync(registro)
  process.exitCode = estado ? 0 : 1
}
