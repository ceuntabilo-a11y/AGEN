#!/usr/bin/env node
/**
 * Refresca el bloque automático de `docs/HANDOFF.md`.
 *
 * Para qué sirve: que una sesión nueva pueda continuar el trabajo sin reconstruir nada.
 * El archivo tiene dos mitades:
 *
 *  - **Automática** (entre las marcas AUTO): rama, HEAD, commits por delante de `main`,
 *    árbol sucio, PR abierto y última ejecución de CI. Se regenera con este script.
 *  - **Manual**: qué está hecho, qué falta, riesgos y el siguiente comando exacto. Eso lo
 *    escribe quien trabaja, porque no se deduce del repositorio.
 *
 * Uso: `npm run handoff`
 *
 * Solo lee: `git` de consulta y, si `gh` está instalado y autenticado, la API de GitHub por
 * GET. Nunca escribe en git, nunca muta nada remoto y nunca imprime secretos. Si `gh` no está
 * disponible, lo dice en el propio archivo en vez de inventar el estado.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARCHIVO = path.join(RAIZ, 'docs', 'HANDOFF.md')
const INICIO = '<!-- AUTO:INICIO -->'
const FIN = '<!-- AUTO:FIN -->'
const REPO = 'ceuntabilo-a11y/AGEN'

/** Ejecuta un comando de solo lectura y devuelve su salida, o null si falla. */
function leer(comando, args) {
  try {
    return execFileSync(comando, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const git = (...args) => leer('git', args)

/**
 * `gh` puede no estar en el PATH (en Windows winget lo instala en "C:\Program Files\GitHub
 * CLI", que no aparece hasta reiniciar la terminal). Se prueban las rutas conocidas.
 */
const CANDIDATOS_GH = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe']

/**
 * Token para `gh`.
 *
 * Si ya hay uno en el entorno se usa ese. Si no, se pide el que Git Credential Manager ya tiene
 * guardado para github.com — el mismo que usa `git push`, así que no hay nada nuevo que
 * autorizar. **Nunca se imprime, ni se escribe en ningún archivo:** vive solo en el entorno del
 * proceso hijo. Si no hay credencial, se sigue sin token y el archivo dirá que no se verificó.
 */
function tokenDeGitHub() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const salida = execFileSync('git', ['credential', 'fill'], {
      cwd: RAIZ,
      encoding: 'utf8',
      input: 'protocol=https\nhost=github.com\n\n',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const linea = salida.split('\n').find((l) => l.startsWith('password='))
    return linea ? linea.slice('password='.length).trim() : null
  } catch {
    return null
  }
}

const TOKEN = tokenDeGitHub()

function gh(...args) {
  const entorno = { ...process.env, GH_PAGER: 'cat', NO_COLOR: '1' }
  if (TOKEN) entorno.GH_TOKEN = TOKEN
  for (const binario of CANDIDATOS_GH) {
    try {
      return execFileSync(binario, args, {
        cwd: RAIZ,
        encoding: 'utf8',
        env: entorno,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      /* siguiente candidato */
    }
  }
  return null
}

const rama = git('rev-parse', '--abbrev-ref', 'HEAD') ?? '(desconocida)'
const head = git('rev-parse', '--short', 'HEAD') ?? '(desconocido)'
const asunto = git('log', '-1', '--pretty=%s') ?? ''
const sucio = git('status', '--porcelain') ?? ''
const adelante = git('rev-list', '--count', 'origin/main..HEAD')
const commits = git('log', '--oneline', '-6') ?? ''
const remoto = git('rev-parse', '--short', `origin/${rama}`)

// PR abierto de esta rama. REST en vez de GraphQL: `gh pr view` exige el scope read:org.
const prCrudo = gh('api', `repos/${REPO}/pulls?state=open&head=ceuntabilo-a11y:${rama}`, '--jq',
  '.[0] | if . == null then "" else "\\(.number)\\t\\(.title)\\t\\(if .draft then "borrador" else "listo" end)\\t\\(.html_url)" end')

// Última ejecución de CI de esta rama.
const ciCrudo = gh('api', `repos/${REPO}/actions/runs?branch=${rama}&per_page=1`, '--jq',
  '.workflow_runs[0] | if . == null then "" else "\\(.id)\\t\\(.status)\\t\\(.conclusion // "en curso")\\t\\(.html_url)" end')

const ghDisponible = prCrudo !== null || ciCrudo !== null

const fila = (crudo) => (crudo ? crudo.split('\t') : null)
const pr = fila(prCrudo)
const ci = fila(ciCrudo)

const lineas = [
  INICIO,
  '',
  '> Bloque generado por `npm run handoff`. No lo edites a mano: se sobrescribe.',
  '',
  '| Dato | Valor |',
  '|---|---|',
  `| Rama | \`${rama}\` |`,
  `| HEAD local | \`${head}\` — ${asunto} |`,
  `| HEAD remoto | ${remoto ? `\`${remoto}\`${remoto === head ? ' (sincronizado)' : ' (**difiere del local**)'}` : 'la rama no está en origin'} |`,
  `| Commits por delante de \`main\` | ${adelante ?? '(no se pudo calcular)'} |`,
  `| Árbol de trabajo | ${sucio ? `**sucio** — ${sucio.split('\n').length} archivo(s)` : 'limpio'} |`,
  `| PR abierto | ${pr ? `[#${pr[0]}](${pr[3]}) — ${pr[1]} (${pr[2]})` : ghDisponible ? 'ninguno' : 'sin `gh`: no verificado'} |`,
  `| Último CI | ${ci ? `${ci[1]} / **${ci[2]}** — ${ci[3]}` : ghDisponible ? 'ninguna ejecución' : 'sin `gh`: no verificado'} |`,
  '',
]

if (sucio) {
  lineas.push('Archivos sin commitear:', '', '```', sucio, '```', '')
}

lineas.push('Últimos commits:', '', '```', commits, '```', '')

if (!ghDisponible) {
  lineas.push(
    '> ⚠️ `gh` no está disponible o no está autenticado, así que el PR y el CI de arriba **no**',
    '> se comprobaron. Instálalo con `winget install --id GitHub.cli` y vuelve a ejecutar',
    '> `npm run handoff`.',
    '',
  )
}

lineas.push(FIN)

const original = readFileSync(ARCHIVO, 'utf8')
const desde = original.indexOf(INICIO)
const hasta = original.indexOf(FIN)
if (desde === -1 || hasta === -1) {
  console.error(`No encontré las marcas ${INICIO} / ${FIN} en docs/HANDOFF.md`)
  process.exit(1)
}

const actualizado = original.slice(0, desde) + lineas.join('\n') + original.slice(hasta + FIN.length)
if (actualizado !== original) writeFileSync(ARCHIVO, actualizado)
console.log(`docs/HANDOFF.md actualizado — rama ${rama}, HEAD ${head}, árbol ${sucio ? 'sucio' : 'limpio'}.`)
