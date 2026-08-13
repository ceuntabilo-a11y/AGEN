#!/usr/bin/env node
/**
 * Watchdog: mira el estado real del trabajo y dice qué hay que hacer ahora.
 *
 * Para qué: que nadie tenga que vigilar la pantalla. Si el trabajo se detuvo —esperando un
 * permiso, esperando que alguien escriba "continúa", con el CI corriendo sin que nadie lo mire,
 * o simplemente parado con backlog pendiente— esto lo detecta y dice el comando exacto para
 * reanudar. Y cuando ya no queda nada, lo dice también.
 *
 * Lo que observa (y lo que no): el watchdog no puede ver si un asistente está esperando un
 * diálogo — eso pasa en una interfaz, no en el disco. Lo que sí ve es la CONSECUENCIA, que es
 * lo que importa: hay trabajo pendiente y el estado no se movió desde la última mirada. Por eso
 * guarda la observación anterior en `.agen-watchdog.json` (ignorado por git).
 *
 * Solo lee: git de consulta, la API de GitHub por GET y `docs/HANDOFF.md`. No commitea, no
 * empuja, no despliega y no toca producción.
 *
 *   npm run watchdog          veredicto legible
 *   npm run watchdog -- --json  veredicto en JSON (para encadenarlo)
 *
 * Códigos de salida, pensados para un bucle:
 *   0  TERMINADO             no queda nada
 *   10 ESPERANDO             el CI está corriendo; hay que seguirlo
 *   20 HAY_TRABAJO           se puede continuar solo
 *   30 INTERVENCION_HUMANA   hace falta una persona
 *   40 ATASCADO              hay trabajo y nada se movió: algo detuvo el avance
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ESTADO = path.join(RAIZ, '.agen-watchdog.json')
const HANDOFF = path.join(RAIZ, 'docs', 'HANDOFF.md')
const REPO = 'ceuntabilo-a11y/AGEN'

import { contarBacklog, decidir } from './watchdog-logica.mjs'

/* ------------------------------------------------------------------ */
/* Recolección del estado real. Todo de solo lectura.                   */
/* ------------------------------------------------------------------ */

function leer(comando, args, extra = {}) {
  try {
    return execFileSync(comando, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...extra }).trim()
  } catch {
    return null
  }
}

const git = (...args) => leer('git', args)

function tokenDeGitHub() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const salida = execFileSync('git', ['credential', 'fill'], {
      cwd: RAIZ, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', stdio: ['pipe', 'pipe', 'ignore'],
    })
    const linea = salida.split('\n').find((item) => item.startsWith('password='))
    return linea ? linea.slice('password='.length).trim() : null
  } catch {
    return null
  }
}

const TOKEN = tokenDeGitHub()
const CANDIDATOS_GH = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']

function gh(...args) {
  const entorno = { ...process.env, GH_PAGER: 'cat', NO_COLOR: '1' }
  if (TOKEN) entorno.GH_TOKEN = TOKEN
  for (const binario of CANDIDATOS_GH) {
    try {
      return execFileSync(binario, args, { cwd: RAIZ, encoding: 'utf8', env: entorno, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { /* siguiente candidato */ }
  }
  return null
}

function observar() {
  const rama = git('rev-parse', '--abbrev-ref', 'HEAD') ?? '(desconocida)'
  const head = git('rev-parse', 'HEAD') ?? ''
  const sucio = (git('status', '--porcelain') ?? '').split('\n').filter((linea) => linea.trim() && !linea.startsWith('??')).length
  const sinEmpujar = Number(git('rev-list', '--count', `origin/${rama}..HEAD`) ?? 0) || 0

  let ci = null
  const crudo = gh('api', `repos/${REPO}/actions/runs?per_page=20`, '--jq',
    `[.workflow_runs[] | select(.head_sha=="${head}" and .name=="CI")][0] | if . == null then "" else "\\(.id)\\t\\(.status)\\t\\(.conclusion // "")" end`)
  if (crudo) {
    const [id, estado, conclusion] = crudo.split('\t')
    ci = { id, estado, conclusion: conclusion || null }
  }

  const backlog = existsSync(HANDOFF) ? contarBacklog(readFileSync(HANDOFF, 'utf8')) : { hechos: 0, pendientes: 0, bloqueados: 0, total: 0 }
  return { rama, head, sucio, sinEmpujar, ci, backlog, ghDisponible: crudo !== null }
}

/* ------------------------------------------------------------------ */

// Solo se ejecuta cuando se lanza como programa. Importarlo (las pruebas importan `decidir` y
// `contarBacklog`) no debe mirar git, ni la red, ni escribir el archivo de estado.
const esEjecucionDirecta = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (esEjecucionDirecta) {
  const estado = observar()
  const anterior = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : null
  const veredicto = decidir(estado, anterior)

  writeFileSync(ESTADO, `${JSON.stringify({ huella: veredicto.huella, veredicto: veredicto.veredicto, visto: new Date().toISOString() }, null, 2)}\n`)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...veredicto, estado }, null, 2))
  } else {
    console.log(`\n  ${veredicto.veredicto}\n`)
    console.log(`  ${veredicto.motivo}\n`)
    console.log(`  rama ${estado.rama} · ${estado.sucio} sin commitear · ${estado.sinEmpujar} sin subir`)
    console.log(`  backlog: ${estado.backlog.hechos} hechos · ${estado.backlog.pendientes} pendientes · ${estado.backlog.bloqueados} esperando al dueño`)
    if (estado.ci) console.log(`  CI: ${estado.ci.estado}${estado.ci.conclusion ? ` / ${estado.ci.conclusion}` : ''}`)
    else if (!estado.ghDisponible) console.log('  CI: no verificado (falta `gh` o el token)')
    else console.log('  CI: sin ejecución para este commit')
    if (veredicto.siguienteComando) console.log(`\n  Siguiente:\n      ${veredicto.siguienteComando}`)
    console.log('')
  }

  process.exitCode = veredicto.codigoSalida
}
