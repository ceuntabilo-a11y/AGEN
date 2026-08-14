#!/usr/bin/env node
/**
 * Ciclo autónomo: detección → actuación → validación → recuperación → alerta.
 *
 * Corre en GitHub Actions (`.github/workflows/autonomia.yml`), así que **no depende de que
 * ninguna máquina concreta esté encendida**. Producción deja de depender de que alguien esté
 * mirando la pantalla o pulsando un botón.
 *
 * Qué puede hacer por su cuenta, y nada más:
 *   · abrir un PR de reversión al último commit verde cuando `main` se pone en rojo;
 *   · abrir, actualizar y cerrar la incidencia de alerta.
 *
 * Qué NO hace nunca: mergear (lo impide la regla de rama, y además un PR abierto por el token
 * de Actions no dispara workflows), reescribir historia, desplegar, tocar producción o borrar
 * cualquier cosa. La reversión se propone; aprobarla y desplegarla sigue siendo humano.
 *
 * Antes de proponer la reversión la VALIDA: revierte en local, corre lint, typecheck y el
 * contrato del agente, y solo si pasa abre el PR. Si la reversión tampoco pasa, no la propone
 * — avisa de que revertir no arregla el problema.
 *
 *   node scripts/autonomia.mjs            simula: detecta, decide y explica, sin escribir nada
 *   node scripts/autonomia.mjs --aplicar  ejecuta la acción decidida
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCIONES, decidirAutonomia, esAccionQueEscribe } from './autonomia-logica.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = process.env.GITHUB_REPOSITORY || 'ceuntabilo-a11y/AGEN'
const ETIQUETA = 'autonomia'
const APLICAR = process.argv.includes('--aplicar')

function correr(comando, args, opciones = {}) {
  return execFileSync(comando, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opciones }).trim()
}

function intentar(comando, args, opciones = {}) {
  try {
    return correr(comando, args, { ...opciones, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

const git = (...args) => intentar('git', args)
const gh = (...args) => intentar('gh', args)

/* --------------------------- 1. Detección --------------------------- */

function detectar() {
  git('fetch', 'origin', 'main', '--quiet')
  const headDeMain = git('rev-parse', 'origin/main') ?? ''

  // Estado de CI de los últimos commits de main, del más nuevo al más viejo.
  const crudo = gh('api', `repos/${REPO}/actions/runs?branch=main&per_page=100`, '--jq',
    '.workflow_runs[] | select(.name=="CI" and .status=="completed") | "\\(.head_sha)\\t\\(.conclusion)"') ?? ''
  const porSha = new Map()
  for (const linea of crudo.split('\n').filter(Boolean)) {
    const [sha, conclusion] = linea.split('\t')
    if (!porSha.has(sha)) porSha.set(sha, conclusion)
  }

  const historia = (git('log', 'origin/main', '-40', '--pretty=%H') ?? '').split('\n').filter(Boolean)
  const ciDeMain = porSha.get(headDeMain) ?? null
  const ultimoVerde = historia.find((sha) => porSha.get(sha) === 'success') ?? null

  const alertaAbierta = Boolean(gh('issue', 'list', '--repo', REPO, '--state', 'open', '--label', ETIQUETA, '--limit', '1', '--json', 'number', '--jq', '.[0].number'))
  const reversionYaAbierta = Boolean(gh('pr', 'list', '--repo', REPO, '--state', 'open', '--head', 'rollback/auto', '--json', 'number', '--jq', '.[0].number'))

  // Salud de producción: reutiliza el mismo monitor que la vigilancia periódica.
  let produccionSana = null
  const destino = process.env.AGEN_APP_URL
  if (destino) {
    try {
      correr(process.execPath, [path.join(RAIZ, 'scripts', 'monitor-salud.mjs'), destino])
      produccionSana = true
    } catch {
      produccionSana = false
    }
  }

  return { headDeMain, ciDeMain, ultimoVerde, alertaAbierta, reversionYaAbierta, produccionSana }
}

/* -------------------- 2. Validación de la reversión ------------------ */

/**
 * Revierte en una rama local y comprueba que el resultado se sostiene solo.
 * No empuja nada: solo dice si la reversión es defendible.
 */
function validarReversion(hasta) {
  const rama = `rollback/auto-${String(hasta).slice(0, 7)}`
  try {
    correr('git', ['switch', '-c', rama, 'origin/main'])
    correr('git', ['revert', '--no-commit', `${hasta}..origin/main`])
    correr('git', ['-c', 'user.name=agen-autonomia', '-c', 'user.email=autonomia@agen.local',
      'commit', '-m', `revert: back to the last green build (${String(hasta).slice(0, 7)})`])
  } catch (error) {
    return { ok: false, rama, motivo: `La reversión ni siquiera se pudo aplicar: ${String(error.message).slice(0, 200)}` }
  }

  for (const guion of ['lint', 'typecheck', 'test:contrato']) {
    try {
      correr('npm', ['run', guion])
    } catch (error) {
      return { ok: false, rama, motivo: `La reversión no pasa \`npm run ${guion}\`: ${String(error.stdout ?? error.message).slice(-400)}` }
    }
  }
  return { ok: true, rama, motivo: 'La reversión pasa lint, typecheck y el contrato del agente.' }
}

/* ------------------------ 3. Alertas (issues) ------------------------ */

function alertar(titulo, cuerpo) {
  const abierta = gh('issue', 'list', '--repo', REPO, '--state', 'open', '--label', ETIQUETA, '--limit', '1', '--json', 'number', '--jq', '.[0].number')
  if (abierta) gh('issue', 'comment', abierta, '--repo', REPO, '--body', cuerpo)
  else gh('issue', 'create', '--repo', REPO, '--title', titulo, '--body', cuerpo, '--label', ETIQUETA)
}

function cerrarAlerta(cuerpo) {
  const abierta = gh('issue', 'list', '--repo', REPO, '--state', 'open', '--label', ETIQUETA, '--limit', '1', '--json', 'number', '--jq', '.[0].number')
  if (!abierta) return
  gh('issue', 'comment', abierta, '--repo', REPO, '--body', cuerpo)
  gh('issue', 'close', abierta, '--repo', REPO)
}

/* ------------------------------ Ciclo -------------------------------- */

const estado = detectar()
let decision = decidirAutonomia(estado)

// La validación solo se hace si de verdad se va a proponer una reversión: es cara.
if (decision.accion === ACCIONES.ROLLBACK && APLICAR) {
  const validacion = validarReversion(decision.hasta)
  if (!validacion.ok) {
    decision = decidirAutonomia({ ...estado, validacionOk: false })
    decision.motivo = `${decision.motivo}\n\n${validacion.motivo}`
  } else {
    decision.rama = validacion.rama
  }
}

console.log(JSON.stringify({ estado, decision, aplicar: APLICAR }, null, 2))

if (!APLICAR) {
  if (esAccionQueEscribe(decision.accion)) console.log(`\n[simulación] Haría: ${decision.accion}. Con --aplicar se ejecuta.`)
  process.exitCode = 0
} else {
  const enlaceRun = process.env.GITHUB_RUN_ID
    ? `\n\nEjecución: https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : ''

  switch (decision.accion) {
    case ACCIONES.ROLLBACK: {
      correr('git', ['push', '-u', 'origin', decision.rama])
      const cuerpo = `main está en rojo. Se propone volver a \`${String(decision.hasta).slice(0, 7)}\`, el último commit con CI verde.\n\n`
        + 'La reversión ya pasó lint, typecheck y el contrato del agente en este mismo run.\n\n'
        + '**No se mergea sola**: `main` exige el check completo y un PR abierto por el token de Actions no dispara workflows. '
        + 'Reejecuta el CI sobre el PR y mergéalo tú.' + enlaceRun
      gh('pr', 'create', '--repo', REPO, '--base', 'main', '--head', decision.rama,
        '--title', `revert: back to the last green build (${String(decision.hasta).slice(0, 7)})`, '--body', cuerpo)
      alertar('Autonomía: main en rojo, reversión propuesta', cuerpo)
      break
    }
    case ACCIONES.ALERTAR_SIN_VERDE:
    case ACCIONES.ALERTAR_ROLLBACK_INVALIDO:
    case ACCIONES.ALERTAR_PRODUCCION:
      alertar('Autonomía: hace falta una persona', `${decision.motivo}${enlaceRun}`)
      break
    case ACCIONES.CERRAR_ALERTA:
      cerrarAlerta(`Recuperado. ${decision.motivo}${enlaceRun}`)
      break
    default:
      break
  }
}
