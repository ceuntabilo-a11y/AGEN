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
 *   node scripts/dev-restart.mjs           reinicia y espera a que /api/health responda
 *   node scripts/dev-restart.mjs --estado  solo informa, no toca nada
 *   node scripts/dev-restart.mjs --detener detiene y NO vuelve a levantar
 *
 * `--detener` existe porque en Windows el dev deja abierto
 * `node_modules/@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node`, y mientras esté
 * abierto `npm ci` falla con EPERM al intentar reemplazarlo. El alcance es el mismo: solo
 * procesos node de Next de ESTE repositorio.
 */
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SALUD = 'http://localhost:3000/api/health'
const LOG = path.join(RAIZ, '.next', 'dev-restart.log')
const soloEstado = process.argv.includes('--estado')
const soloDetener = process.argv.includes('--detener')

/**
 * Puertos que este repositorio se reserva: 3000 el servidor de desarrollo, 3010 el de
 * producción local. Sirven como segunda forma de identificar un proceso de AGEN cuando la
 * línea de comando trae el binario de Next por ruta relativa (`node ./node_modules/next/...`)
 * y por tanto no contiene la ruta del repositorio.
 */
const PUERTOS = ['-p 3000', '-p 3010']
const BIN_RELATIVO = 'node_modules/next/dist/bin/next'

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
      // Cinturón extra, antes que nada: jamás tocar MediCore, que vive en la misma máquina.
      if (linea.includes('medicore')) return false
      if (!linea.includes('next')) return false

      // Caso normal: la línea de comando trae la ruta de este repositorio.
      if (linea.includes(raizNormalizada)) return true

      // Caso del binario por ruta relativa: entonces exigimos el binario EXACTO de Next y uno
      // de los puertos reservados de AGEN. Sin las dos cosas a la vez no se toca el proceso.
      return linea.includes(BIN_RELATIVO) && PUERTOS.some((puerto) => linea.includes(puerto))
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

  if (soloDetener) {
    // Windows tarda un instante en soltar el .node nativo de Next.
    await new Promise((listo) => setTimeout(listo, 1500))
    console.log('detenido sin reiniciar (--detener)')
    process.exit(0)
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
