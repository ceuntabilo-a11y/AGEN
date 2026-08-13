/**
 * Approval Gateway — la puerta que decide qué se ejecuta solo, qué se bloquea y qué necesita
 * una persona.
 *
 * Es para la AUTOMATIZACIÓN TÉCNICA de AGEN, no para el negocio: acá no se aprueban reservas,
 * ni cancelaciones de clientes, ni campañas. Lo que se clasifica son las acciones que ejecuta
 * quien está trabajando en el repositorio.
 *
 * Las tres decisiones:
 *
 *   `auto`     Normal, segura y reversible. Se ejecuta sin preguntar. Leer, probar, compilar,
 *              commitear, empujar una rama, consultar el CI.
 *   `bloqueado` Destructiva o irreversible. No se ejecuta y NO se pregunta, porque preguntar
 *              por algo que nunca debe pasar solo sirve para que algún día alguien diga que sí.
 *   `humano`   Ambigua o de riesgo, y ninguna herramienta la puede resolver sola: ni el CI, ni
 *              Playwright, ni las pruebas, ni el monitor de salud, ni el rollback. Cambiar el
 *              grafo de dependencias, desplegar, tocar el n8n real.
 *
 * La fuente de verdad es `.claude/settings.local.json`, no una segunda copia de las reglas:
 * `deny` → bloqueado, `ask` → humano, `allow` → auto, con la precedencia deny > ask > allow.
 * Lo que aporta este módulo es que esa política se puede **consultar y probar**, en vez de
 * descubrirse a base de diálogos.
 *
 * Lo que no aparece en ninguna lista se clasifica como `humano`. Ante la duda, pregunta: es el
 * único fallo por defecto que no rompe nada.
 */

/**
 * Traduce un patrón de permiso (`Bash(git push*)`) a expresión regular.
 * El `*` es el único comodín y significa "cualquier cosa"; el resto es literal.
 */
export function patronARegExp(patron) {
  const escapado = patron.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escapado}$`, 's')
}

/** ¿La herramienta y el comando encajan con esta regla? */
export function coincide(regla, herramienta, comando) {
  const corte = regla.indexOf('(')
  if (corte < 0) return regla === herramienta
  const nombre = regla.slice(0, corte)
  if (nombre !== herramienta) return false
  const patron = regla.slice(corte + 1, regla.lastIndexOf(')'))
  return patronARegExp(patron).test(comando)
}

/** Convierte el contenido de settings.local.json en la política. Sin tocar el disco. */
export function parsearPolitica(contenido) {
  const datos = JSON.parse(contenido)
  const permisos = datos.permissions ?? {}
  const limpia = (lista) => (Array.isArray(lista) ? lista.filter((item) => typeof item === 'string') : [])
  return { allow: limpia(permisos.allow), ask: limpia(permisos.ask), deny: limpia(permisos.deny) }
}

/**
 * Clasifica una acción.
 *
 * @param {string} comando  Lo que se va a ejecutar, tal cual (`git push`, `rm -rf build`).
 * @param {object} [opciones]
 * @param {string} [opciones.herramienta]  `Bash` por defecto.
 * @param {object} [opciones.politica]     Política ya cargada (para pruebas).
 * @returns {{decision:'auto'|'bloqueado'|'humano', motivo:string, regla:string|null}}
 */
export function clasificar(comando, opciones = {}) {
  const herramienta = opciones.herramienta ?? 'Bash'
  const politica = opciones.politica
  const texto = String(comando ?? '').trim()

  if (!texto) return { decision: 'humano', motivo: 'No hay ninguna acción que clasificar.', regla: null }

  // Un encadenado vale lo que valga su parte MÁS restrictiva: `ls && rm -rf x` es un borrado.
  const partes = texto.split(/&&|\|\||;|\|/).map((parte) => parte.trim()).filter(Boolean)
  if (partes.length > 1) {
    const decisiones = partes.map((parte) => clasificar(parte, { herramienta, politica }))
    const bloqueada = decisiones.find((item) => item.decision === 'bloqueado')
    if (bloqueada) return { ...bloqueada, motivo: `Parte del encadenado está bloqueada: ${bloqueada.motivo}` }
    const humana = decisiones.find((item) => item.decision === 'humano')
    if (humana) return { ...humana, motivo: `Parte del encadenado necesita aprobación: ${humana.motivo}` }
    return { decision: 'auto', motivo: 'Todas las partes del encadenado son seguras y reversibles.', regla: null }
  }

  const buscar = (lista) => lista.find((regla) => coincide(regla, herramienta, texto)) ?? null

  const denegada = buscar(politica.deny)
  if (denegada) return { decision: 'bloqueado', motivo: 'Destructiva o irreversible: no se ejecuta y no se pregunta.', regla: denegada }

  const preguntada = buscar(politica.ask)
  if (preguntada) return { decision: 'humano', motivo: 'Ninguna herramienta puede resolver esto sola: hace falta una decisión.', regla: preguntada }

  const permitida = buscar(politica.allow)
  if (permitida) return { decision: 'auto', motivo: 'Normal, segura y reversible.', regla: permitida }

  return {
    decision: 'humano',
    motivo: 'No está en ninguna lista. Ante la duda se pregunta: es el único fallo por defecto que no rompe nada.',
    regla: null,
  }
}

/**
 * Acciones que SIEMPRE tienen que estar bloqueadas, pase lo que pase con el archivo.
 *
 * Es la red de seguridad de la propia política: si alguien edita `settings.local.json` y borra
 * una regla de `deny` sin darse cuenta, `auditar()` lo dice en vez de descubrirse el día que
 * se ejecute. Cada una está aquí porque no se puede deshacer.
 */
export const NUNCA = [
  'git push --force',
  'git push --force-with-lease origin main',
  'git reset --hard HEAD~3',
  'git clean -fd',
  'git restore .',
  'git branch -D main',
  'git filter-branch --all',
  'rm -rf src',
  'rmdir build',
  'psql postgres://x',
  'gh repo delete ceuntabilo-a11y/AGEN',
  'gh secret set FOO',
  'gh pr merge 1 --admin',
  'gh run delete 1',
]

/** Acciones que tienen que poder ejecutarse solas, o el trabajo no avanza sin operador. */
export const SIEMPRE_AUTO = [
  'git status --short',
  'git add tests/contract/x.spec.ts',
  'git commit -m "fix: algo"',
  'git push',
  'git fetch origin',
  'git branch --show-current',
  'npm run lint',
  'npm run typecheck',
  'npm run test:contrato',
  'npm ci',
  'CI=1 npm run test:contrato',
  'node scripts/monitor-salud.mjs http://127.0.0.1:3010',
]

/**
 * Comprueba que la política vigente cumple las dos listas de arriba.
 * @returns {{ok:boolean, fallos:Array<{accion:string, esperado:string, obtenido:string}>}}
 */
export function auditar(politica) {
  const fallos = []
  for (const accion of NUNCA) {
    const { decision } = clasificar(accion, { politica })
    if (decision !== 'bloqueado') fallos.push({ accion, esperado: 'bloqueado', obtenido: decision })
  }
  for (const accion of SIEMPRE_AUTO) {
    const { decision } = clasificar(accion, { politica })
    if (decision !== 'auto') fallos.push({ accion, esperado: 'auto', obtenido: decision })
  }
  return { ok: fallos.length === 0, fallos }
}
