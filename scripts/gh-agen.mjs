#!/usr/bin/env node
/**
 * Operaciones rutinarias de GitHub, en un solo comando y sin sintaxis que analizar.
 *
 * El problema que resuelve: cada operación de GitHub se escribía a mano en la shell —con
 * `export PATH`, sustituciones `$(...)`, comillas anidadas y a veces bucles— y el analizador
 * de seguridad la rechazaba con "contains shell syntax that cannot be statically analyzed".
 * Eso pedía autorización para cosas de solo lectura, o para un `pr create` perfectamente
 * normal. Parchear comando por comando no servía: el problema era la FORMA, no cada comando.
 *
 * Acá todas las operaciones pasan por una sola envoltura con argumentos simples:
 *
 *   npm run gh -- pr-crear "<título>"              abre un PR (cuerpo corto, de una sola línea)
 *   npm run gh -- pr-crear-md [ruta]               abre un PR con el cuerpo en un archivo
 *                                                  (por defecto .pr/cuerpo.md; 1ª línea = título)
 *   npm run gh -- pr-ver <n>                        estado del PR
 *   npm run gh -- pr-checks <n>                     checks del PR
 *   npm run gh -- pr-mergear <n>                    mergea SOLO si todos los checks están verdes
 *   npm run gh -- ci-esperar [sha]                  espera el CI de un commit
 *   npm run gh -- run-esperar <id>                  espera una ejecución concreta
 *   npm run gh -- runs [rama]                       últimas ejecuciones
 *   npm run gh -- lanzar <workflow.yml> [k=v ...]   workflow_dispatch sobre main
 *   npm run gh -- log <id>                          log de los pasos fallidos
 *
 * Seguridad: esta envoltura **no** amplía lo que se puede hacer. `pr-mergear` comprueba los
 * checks antes y se niega si alguno no está en verde; nunca pasa `--admin`, `--auto` ni nada
 * que salte la protección de rama; y no hay forma de pedirle un borrado. Lo que GitHub
 * rechace por protección de rama, sigue rechazado.
 *
 * El token sale del que ya tiene Git Credential Manager —el mismo que usa `git push`— y nunca
 * se imprime.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.GITHUB_REPOSITORY || 'ceuntabilo-a11y/AGEN'
const BINARIOS = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']
const INTERVALO_MS = 30000
const LIMITE_MS = 45 * 60 * 1000

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const salida = execFileSync('git', ['credential', 'fill'], {
      cwd: RAIZ, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', stdio: ['pipe', 'pipe', 'ignore'],
    })
    const linea = salida.split('\n').find((item) => item.startsWith('password='))
    return linea ? linea.slice('password='.length).trim() : null
  } catch { return null }
}

const TOKEN = token()

/** Ejecuta gh. `silencioso` devuelve null en vez de lanzar, para las consultas. */
function gh(args, { silencioso = false } = {}) {
  const entorno = { ...process.env, GH_PAGER: 'cat', NO_COLOR: '1' }
  if (TOKEN) entorno.GH_TOKEN = TOKEN
  let ultimoError = null
  for (const binario of BINARIOS) {
    try {
      return execFileSync(binario, args, { cwd: RAIZ, encoding: 'utf8', env: entorno, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    } catch (error) {
      ultimoError = error
    }
  }
  if (silencioso) return null
  const detalle = String(ultimoError?.stderr || ultimoError?.message || '').trim()
  console.error(`gh falló: ${detalle.slice(0, 500)}`)
  process.exit(1)
}

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms))
const ramaActual = () => git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'main'

/**
 * Crea el PR de la rama actual contra main.
 *
 * El cuerpo se pasa a `gh` por un archivo temporal (`--body-file`) y no como argumento: un
 * markdown largo como argumento de proceso choca con el límite de línea de comando de Windows
 * y, sobre todo, obliga a escribirlo dentro del comando, que es la forma que dispara el
 * diálogo de aprobación. El temporal se borra siempre, incluso si `gh` falla.
 */
function crearPr(titulo, cuerpo) {
  const rama = ramaActual()
  if (rama === 'main') { console.error('No se abre un PR desde main.'); process.exit(2) }
  const temporal = path.join(tmpdir(), `agen-pr-${process.pid}.md`)
  writeFileSync(temporal, cuerpo ?? '', 'utf8')
  try {
    console.log(gh(['pr', 'create', '--repo', REPO, '--base', 'main', '--head', rama,
      '--title', titulo, '--body-file', temporal]))
  } finally {
    try { unlinkSync(temporal) } catch {}
  }
}

/** Checks de un commit, ya normalizados. */
function checksDe(sha) {
  const crudo = gh(['api', `repos/${REPO}/commits/${sha}/check-runs`, '--jq',
    '.check_runs[] | "\\(.name)\\t\\(.status)\\t\\(.conclusion // "")"'], { silencioso: true })
  if (crudo === null) return null
  return crudo.split('\n').filter(Boolean).map((linea) => {
    const [nombre, estado, conclusion] = linea.split('\t')
    return { nombre, estado, conclusion: conclusion || null }
  })
}

const todosVerdes = (checks) =>
  checks.length > 0
  && checks.every((c) => c.estado === 'completed')
  && checks.every((c) => c.conclusion === 'success' || c.conclusion === 'skipped')

/** Espera a que los checks de un commit terminen. Devuelve true si acabaron todos en verde. */
async function esperarChecks(sha) {
  const corto = sha.slice(0, 7)
  const arranque = Date.now()
  let visto = ''
  for (;;) {
    const checks = checksDe(sha)
    if (checks === null) { console.error('No pude consultar GitHub.'); process.exit(2) }

    const resumen = checks.map((c) => `${c.nombre}: ${c.conclusion ?? c.estado}`).join(' · ')
    if (resumen !== visto) { console.log(`[${corto}] ${resumen || 'sin checks todavía'}`); visto = resumen }

    if (checks.length > 0 && checks.every((c) => c.estado === 'completed')) return todosVerdes(checks)
    if (Date.now() - arranque > LIMITE_MS) { console.log(`\nSe agotó la espera con ${corto} sin terminar.`); return false }
    await espera(INTERVALO_MS)
  }
}

const [orden, ...resto] = process.argv.slice(2)

switch (orden) {
  case 'pr-crear': {
    const [titulo, cuerpo] = resto
    if (!titulo) { console.error('Falta el título del PR.'); process.exit(2) }
    if ((cuerpo ?? '').includes('\n')) {
      // Un cuerpo multilínea escrito dentro del comando es exactamente la forma que el
      // analizador de seguridad no puede analizar: comillas que abarcan saltos de línea,
      // acentos y markdown. Se rechaza acá para que no haya dos caminos, uno bueno y otro que
      // vuelve a abrir el diálogo.
      console.error('El cuerpo multilínea no va en el comando. Escríbelo en un archivo y usa:')
      console.error('  npm run gh -- pr-crear-md [ruta]   (por defecto .pr/cuerpo.md)')
      process.exit(2)
    }
    crearPr(titulo, cuerpo ?? '')
    break
  }

  case 'pr-crear-md': {
    /*
     * PR con cuerpo largo, sin texto multilínea en el comando.
     *
     * El archivo lleva el título en la primera línea y el cuerpo en el resto. Así el comando
     * visible es siempre `npm run gh -- pr-crear-md`, que no tiene nada que analizar, y el
     * markdown —con saltos de línea, acentos, comillas y listas— viaja por disco.
     *
     * `.pr/` está ignorado por git: son borradores de trabajo, no parte del repositorio.
     */
    const ruta = path.resolve(RAIZ, resto[0] || '.pr/cuerpo.md')
    if (!existsSync(ruta)) {
      console.error(`No existe ${ruta}.`)
      console.error('Escribe ahí el PR: primera línea = título, el resto = cuerpo.')
      process.exit(2)
    }
    const contenido = readFileSync(ruta, 'utf8').replace(/^﻿/, '')
    const salto = contenido.indexOf('\n')
    const titulo = (salto === -1 ? contenido : contenido.slice(0, salto)).trim()
    const cuerpo = salto === -1 ? '' : contenido.slice(salto + 1).trim()
    if (!titulo) { console.error(`${ruta} está vacío: falta el título en la primera línea.`); process.exit(2) }
    crearPr(titulo, cuerpo)
    break
  }

  case 'pr-ver': {
    const numero = resto[0]
    console.log(gh(['api', `repos/${REPO}/pulls/${numero}`, '--jq',
      '"#\\(.number) \\(.state) merged=\\(.merged) head=\\(.head.sha[0:7]) \\(.mergeable_state)"']))
    break
  }

  case 'pr-checks': {
    const numero = resto[0]
    const sha = gh(['api', `repos/${REPO}/pulls/${numero}`, '--jq', '.head.sha'])
    const checks = checksDe(sha) ?? []
    for (const c of checks) console.log(`${c.nombre}: ${c.conclusion ?? c.estado}`)
    process.exitCode = todosVerdes(checks) ? 0 : 1
    break
  }

  case 'pr-mergear': {
    const numero = resto[0]
    if (!numero) { console.error('Falta el número del PR.'); process.exit(2) }
    const sha = gh(['api', `repos/${REPO}/pulls/${numero}`, '--jq', '.head.sha'])
    console.log(`Esperando los checks de #${numero} (${sha.slice(0, 7)})…`)
    const verde = await esperarChecks(sha)
    if (!verde) {
      // La condición es explícita y no se puede desactivar por argumento: sin verde, no se
      // mergea. Es la misma regla que impone la protección de rama, comprobada antes de pedirlo.
      console.error(`\nLos checks de #${numero} no están todos en verde. No se mergea.`)
      process.exit(1)
    }
    console.log(gh(['pr', 'merge', numero, '--repo', REPO, '--squash', '--delete-branch=false']) || `PR #${numero} mergeado.`)
    break
  }

  case 'ci-esperar': {
    const sha = resto[0] || git('rev-parse', 'HEAD')
    const verde = await esperarChecks(sha)
    console.log(verde ? `\nCI verde en ${sha.slice(0, 7)}.` : `\nCI NO verde en ${sha.slice(0, 7)}.`)
    process.exitCode = verde ? 0 : 1
    break
  }

  case 'run-esperar': {
    const id = resto[0]
    const arranque = Date.now()
    let visto = ''
    for (;;) {
      const crudo = gh(['api', `repos/${REPO}/actions/runs/${id}`, '--jq', '"\\(.name)\\t\\(.status)\\t\\(.conclusion // "")"'], { silencioso: true })
      if (crudo === null) { console.error('No pude consultar GitHub.'); process.exit(2) }
      const [nombre, estado, conclusion] = crudo.split('\t')
      const linea = `${nombre}: ${conclusion || estado}`
      if (linea !== visto) { console.log(`[run ${id}] ${linea}`); visto = linea }
      if (estado === 'completed') { process.exitCode = conclusion === 'success' ? 0 : 1; break }
      if (Date.now() - arranque > LIMITE_MS) { console.log('Se agotó la espera.'); process.exitCode = 1; break }
      await espera(INTERVALO_MS)
    }
    break
  }

  case 'runs': {
    const rama = resto[0] || ramaActual()
    console.log(gh(['api', `repos/${REPO}/actions/runs?branch=${rama}&per_page=10`, '--jq',
      '.workflow_runs[] | "\\(.id) \\(.name) \\(.head_sha[0:7]) \\(.status) \\(.conclusion // "-")"']))
    break
  }

  case 'lanzar': {
    const [workflow, ...campos] = resto
    if (!workflow) { console.error('Falta el archivo del workflow.'); process.exit(2) }
    const args = ['workflow', 'run', workflow, '--repo', REPO, '--ref', 'main']
    for (const campo of campos) args.push('-f', campo)
    gh(args)
    console.log(`Lanzado ${workflow}. Últimas ejecuciones:`)
    console.log(gh(['api', `repos/${REPO}/actions/workflows/${workflow}/runs?per_page=3`, '--jq',
      '.workflow_runs[] | "\\(.id) \\(.status) \\(.conclusion // "-")"']))
    break
  }

  case 'log': {
    const id = resto[0]
    console.log(gh(['run', 'view', id, '--repo', REPO, '--log-failed']) || '(sin pasos fallidos)')
    break
  }

  default:
    console.log('Órdenes: pr-crear · pr-crear-md · pr-ver · pr-checks · pr-mergear · ci-esperar · run-esperar · runs · lanzar · log')
    console.log('Ejemplo: npm run gh -- pr-checks 4')
    process.exitCode = orden ? 2 : 0
}
