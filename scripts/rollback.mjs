#!/usr/bin/env node
/**
 * A qué commit volver cuando producción se rompe.
 *
 * Por qué no revierte solo: el despliegue de AGEN es un paso manual del dueño en EasyPanel.
 * Aunque este script revirtiera `main`, nadie desplegaría esa reversión — así que un
 * "rollback automático" de verdad exige antes automatizar el despliegue, y eso necesita las
 * credenciales de EasyPanel. Lo que sí se puede automatizar sin credenciales es la parte que
 * de verdad cuesta a las 3 de la mañana: **saber a qué commit volver** y tener el comando
 * exacto delante.
 *
 * Qué hace: recorre `main` de lo más nuevo a lo más viejo y busca el commit más reciente cuyo
 * CI terminó en verde. Ese es el candidato. Solo lee: no cambia ramas, no revierte y no
 * despliega nada.
 *
 * Uso:
 *   npm run rollback          -- candidato y pasos, mirando los últimos 20 commits
 *   npm run rollback -- 50    -- mirar más atrás
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'ceuntabilo-a11y/AGEN'
const CUANTOS = Math.min(100, Math.max(1, Number(process.argv[2]) || 20))

function leer(comando, args, opciones = {}) {
  try {
    return execFileSync(comando, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opciones }).trim()
  } catch {
    return null
  }
}

const git = (...args) => leer('git', args)

/** Token de Git Credential Manager, sin imprimirlo nunca. Igual que en scripts/handoff.mjs. */
function tokenDeGitHub() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const salida = execFileSync('git', ['credential', 'fill'], {
      cwd: RAIZ, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', stdio: ['pipe', 'pipe', 'ignore'],
    })
    const linea = salida.split('\n').find((l) => l.startsWith('password='))
    return linea ? linea.slice('password='.length).trim() : null
  } catch {
    return null
  }
}

const CANDIDATOS_GH = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']
const TOKEN = tokenDeGitHub()

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

git('fetch', 'origin', 'main', '--quiet')
const commits = (git('log', 'origin/main', `-${CUANTOS}`, '--pretty=%H%x09%s') ?? '')
  .split('\n').filter(Boolean)
  .map((linea) => {
    const [sha, ...resto] = linea.split('\t')
    return { sha, asunto: resto.join('\t') }
  })

if (!commits.length) {
  console.error('No pude leer el historial de origin/main. ¿Hay red y remoto configurado?')
  process.exitCode = 1
} else {
  // Una sola llamada: el estado de CI de los últimos runs de main, indexado por commit.
  const crudo = gh('api', `repos/${REPO}/actions/runs?branch=main&per_page=100`, '--jq',
    '.workflow_runs[] | select(.name=="CI") | "\\(.head_sha)\\t\\(.conclusion // "en curso")\\t\\(.html_url)"')

  if (crudo === null) {
    console.error('No pude consultar GitHub Actions (¿falta `gh` o el token?).')
    console.error('Sin eso no se puede saber qué commit estaba verde: revísalo a mano antes de revertir.')
    process.exitCode = 1
  } else {
    const porSha = new Map()
    for (const linea of crudo.split('\n').filter(Boolean)) {
      const [sha, conclusion, url] = linea.split('\t')
      if (!porSha.has(sha)) porSha.set(sha, { conclusion, url })
    }

    console.log(`Últimos ${commits.length} commits de main:\n`)
    let candidato = null
    for (const commit of commits) {
      const ci = porSha.get(commit.sha)
      const estado = !ci ? 'sin CI' : ci.conclusion
      const marca = estado === 'success' ? 'VERDE ' : estado === 'sin CI' ? '  ?   ' : ' ROJO '
      if (!candidato && estado === 'success') candidato = commit
      console.log(`${marca} ${commit.sha.slice(0, 7)}  ${commit.asunto.slice(0, 70)}`)
    }

    console.log('')
    if (!candidato) {
      console.log(`Ningún commit verde en los últimos ${commits.length}. Prueba a mirar más atrás:`)
      console.log(`    npm run rollback -- ${Math.min(100, commits.length * 2)}`)
      process.exitCode = 1
    } else {
      const actual = git('rev-parse', 'origin/main')
      if (candidato.sha === actual) {
        console.log(`main ya está en el último commit verde (${candidato.sha.slice(0, 7)}). No hay nada que revertir.`)
        console.log('Si producción está rota igualmente, el problema no vino de este repositorio:')
        console.log('mira los logs del contenedor en EasyPanel, Supabase y n8n antes de tocar el código.')
      } else {
        const cuantosAtras = commits.findIndex((c) => c.sha === candidato.sha)
        console.log(`Último commit verde: ${candidato.sha.slice(0, 7)} — ${candidato.asunto}`)
        console.log(`Está ${cuantosAtras} commit(s) por detrás de main.\n`)
        console.log('Para volver a él sin reescribir historia (revierte hacia adelante):\n')
        console.log('    git switch -c rollback/a-' + candidato.sha.slice(0, 7) + ' origin/main')
        console.log(`    git revert --no-commit ${candidato.sha}..origin/main`)
        console.log('    git commit -m "revert: back to the last green build"')
        console.log('    git push -u origin HEAD')
        console.log('    # abre el PR, espera CI verde y mergea\n')
        console.log('Y DESPUÉS, en EasyPanel: servicio de la app → botón "Implementar".')
        console.log('El despliegue no es automático: sin ese clic, producción sigue con el código roto.')
      }
    }
  }
}
