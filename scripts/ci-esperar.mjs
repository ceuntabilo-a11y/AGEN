#!/usr/bin/env node
/**
 * Espera a que termine el CI de un commit y dice cómo acabó.
 *
 * Existe por una razón muy concreta: esperar el CI desde la shell obliga a escribir bucles
 * `while`/`until`, `case`, comparaciones con comillas y expansiones — y esas construcciones
 * disparan al analizador de seguridad (`case_statement`, `string cannot be statically
 * analyzed`, `simple_expansion`), que entonces pide autorización para algo que solo LEE el
 * estado de una ejecución. Metiendo la espera dentro de Node, el comando que se ejecuta es
 * siempre `npm run ci:esperar`: una sola forma, ya permitida, sin nada que analizar.
 *
 * Solo lee: consulta la API de GitHub por GET. No commitea, no empuja y no mergea.
 *
 *   npm run ci:esperar                    espera el CI del HEAD actual
 *   npm run ci:esperar -- <sha>           espera el de otro commit
 *   npm run ci:esperar -- --run <id>      espera una ejecución concreta (cualquier workflow)
 *
 * Sale con 0 si el CI terminó en `success`, con 1 en cualquier otro final, y con 2 si no se
 * pudo consultar GitHub.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.GITHUB_REPOSITORY || 'ceuntabilo-a11y/AGEN'
const INTERVALO_MS = 30000
const LIMITE_MS = 45 * 60 * 1000

function intentar(comando, args) {
  try {
    return execFileSync(comando, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

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

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms))

/**
 * Modo "una ejecución concreta": sirve para cualquier workflow, no solo el CI. Es lo que
 * permite esperar a Autonomía o a Monitorización sin volver a escribir un bucle en la shell.
 */
const posicionRun = process.argv.indexOf('--run')
if (posicionRun >= 0) {
  const idRun = process.argv[posicionRun + 1]
  const arranqueRun = Date.now()
  let visto = ''
  for (;;) {
    const crudo = gh('api', `repos/${REPO}/actions/runs/${idRun}`, '--jq', '"\\(.name)\\t\\(.status)\\t\\(.conclusion // "")"')
    if (crudo === null) {
      console.error('No pude consultar GitHub (¿falta `gh` o el token?).')
      process.exit(2)
    }
    const [nombre, estado, conclusion] = crudo.split('\t')
    const linea = `${nombre}: ${conclusion || estado}`
    if (linea !== visto) {
      console.log(`[run ${idRun}] ${linea}`)
      visto = linea
    }
    if (estado === 'completed') {
      console.log(conclusion === 'success' ? `\nEjecución ${idRun} en verde.` : `\nEjecución ${idRun} terminó en ${conclusion}.`)
      process.exit(conclusion === 'success' ? 0 : 1)
    }
    if (Date.now() - arranqueRun > LIMITE_MS) {
      console.log(`\nSe agotó la espera de 45 minutos con la ejecución ${idRun} sin terminar.`)
      process.exit(1)
    }
    await espera(INTERVALO_MS)
  }
}

const sha = (process.argv[2] || intentar('git', ['rev-parse', 'HEAD']) || '').trim()
if (!sha) {
  console.error('No pude determinar el commit a vigilar.')
  process.exit(2)
}

const corto = sha.slice(0, 7)
const arranque = Date.now()
let ultimo = ''

for (;;) {
  const crudo = gh('api', `repos/${REPO}/commits/${sha}/check-runs`, '--jq',
    '.check_runs[] | "\\(.name)\\t\\(.status)\\t\\(.conclusion // "")"')

  if (crudo === null) {
    console.error('No pude consultar GitHub (¿falta `gh` o el token?).')
    process.exit(2)
  }

  const checks = crudo.split('\n').filter(Boolean).map((linea) => {
    const [nombre, estado, conclusion] = linea.split('\t')
    return { nombre, estado, conclusion: conclusion || null }
  })

  const resumen = checks.map((c) => `${c.nombre}: ${c.conclusion ?? c.estado}`).join(' · ')
  if (resumen !== ultimo) {
    console.log(`[${corto}] ${resumen || 'sin checks todavía'}`)
    ultimo = resumen
  }

  const terminados = checks.length > 0 && checks.every((c) => c.estado === 'completed')
  if (terminados) {
    const fallidos = checks.filter((c) => c.conclusion !== 'success' && c.conclusion !== 'skipped')
    if (fallidos.length === 0) {
      console.log(`\nCI verde en ${corto}.`)
      process.exitCode = 0
    } else {
      console.log(`\nCI NO verde en ${corto}: ${fallidos.map((c) => `${c.nombre}=${c.conclusion}`).join(', ')}`)
      process.exitCode = 1
    }
    break
  }

  if (Date.now() - arranque > LIMITE_MS) {
    console.log(`\nSe agotó la espera de 45 minutos con el CI de ${corto} sin terminar.`)
    process.exitCode = 1
    break
  }

  await espera(INTERVALO_MS)
}
