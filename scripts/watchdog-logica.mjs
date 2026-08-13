/**
 * Cerebro del watchdog: decide qué pasa a partir del estado observado.
 *
 * Sin git, sin red, sin disco y sin reloj — todo entra por parámetro. Está separado de
 * `watchdog.mjs` (que es el que mira el mundo real) justamente para poder probarlo.
 */
const REPO = 'ceuntabilo-a11y/AGEN'

export const CODIGOS = { TERMINADO: 0, ESPERANDO: 10, HAY_TRABAJO: 20, INTERVENCION_HUMANA: 30, ATASCADO: 40 }

/**
 * Decide qué pasa, a partir del estado observado y del anterior. Función pura: es lo que se
 * puede probar sin git, sin red y sin reloj.
 *
 * El orden de las preguntas es la política del watchdog y no es casual:
 *  1. Un bloqueo humano manda sobre todo lo demás: seguir solo no lo va a resolver.
 *  2. El CI en curso se espera antes que nada, para no empujar encima y cancelarlo.
 *  3. El CI rojo es lo primero que se arregla: sin eso, nada más importa.
 *  4. Después el trabajo local a medias, después el backlog.
 *  5. Y solo si NADA de eso cambió desde la última mirada, se declara atascado.
 */
export function decidir(estado, anterior) {
  const pendientes = estado.backlog?.pendientes ?? 0
  const bloqueados = estado.backlog?.bloqueados ?? 0
  const hayTrabajoLocal = estado.sucio > 0 || estado.sinEmpujar > 0

  const huella = JSON.stringify({
    head: estado.head, sucio: estado.sucio, sinEmpujar: estado.sinEmpujar,
    ci: estado.ci?.conclusion ?? estado.ci?.estado ?? null, pendientes,
  })
  const igualQueAntes = Boolean(anterior?.huella) && anterior.huella === huella

  const salida = (veredicto, motivo, siguienteComando) => ({
    veredicto, motivo, siguienteComando, huella, codigoSalida: CODIGOS[veredicto],
  })

  if (estado.ci?.estado === 'in_progress' || estado.ci?.estado === 'queued') {
    return salida('ESPERANDO', `El CI del commit ${estado.head.slice(0, 7)} sigue corriendo. No empujes encima: el workflow cancela la ejecución anterior.`,
      `gh run watch ${estado.ci.id} --repo ${REPO}`)
  }

  if (estado.ci && estado.ci.conclusion && estado.ci.conclusion !== 'success' && estado.ci.conclusion !== 'cancelled') {
    return salida('HAY_TRABAJO', `El CI del commit ${estado.head.slice(0, 7)} terminó en ${estado.ci.conclusion}. Se arregla antes que cualquier otra cosa.`,
      `gh run view ${estado.ci.id} --repo ${REPO} --log-failed`)
  }

  if (hayTrabajoLocal && igualQueAntes) {
    return salida('ATASCADO', `Hay ${estado.sucio} archivo(s) sin commitear y ${estado.sinEmpujar} commit(s) sin subir, y nada se movió desde la última mirada. El trabajo está detenido.`,
      'npm run lint && npm run typecheck && npm run test:contrato')
  }

  if (hayTrabajoLocal) {
    return salida('HAY_TRABAJO', `Trabajo a medias: ${estado.sucio} archivo(s) sin commitear, ${estado.sinEmpujar} commit(s) sin subir.`,
      'npm run lint && npm run typecheck && npm run test:contrato')
  }

  if (pendientes > 0 && igualQueAntes) {
    return salida('ATASCADO', `Quedan ${pendientes} punto(s) del backlog y nada se movió desde la última mirada. Algo detuvo el avance.`,
      'Abre docs/HANDOFF.md y sigue por el primer punto sin marcar.')
  }

  if (pendientes > 0) {
    return salida('HAY_TRABAJO', `Todo está verde y quedan ${pendientes} punto(s) del backlog.`,
      'Abre docs/HANDOFF.md y sigue por el primer punto sin marcar.')
  }

  if (bloqueados > 0) {
    return salida('INTERVENCION_HUMANA', `No queda trabajo que se pueda hacer solo, pero hay ${bloqueados} punto(s) esperando al dueño.`,
      'Mira "Pendiente del dueño" en docs/HANDOFF.md.')
  }

  return salida('TERMINADO', 'Árbol limpio, todo subido, CI en verde y el backlog cerrado. No queda nada.', null)
}

/**
 * Cuenta el backlog de `docs/HANDOFF.md`.
 *
 * Formato esperado, una línea por punto dentro de la sección del backlog:
 *   - [x] 4. …   hecho
 *   - [ ] 10. …  pendiente y se puede hacer solo
 *   - [!] 6. …   bloqueado esperando al dueño (credencial o decisión)
 */
export function contarBacklog(markdown) {
  const seccion = markdown.split(/^##\s+Backlog maestro/m)[1]
  if (!seccion) return { hechos: 0, pendientes: 0, bloqueados: 0, total: 0 }
  const cuerpo = seccion.split(/^##\s+/m)[0]
  const marcas = [...cuerpo.matchAll(/^\s*-\s*\[([ x!])\]/gim)].map((coincidencia) => coincidencia[1].toLowerCase())
  return {
    hechos: marcas.filter((marca) => marca === 'x').length,
    pendientes: marcas.filter((marca) => marca === ' ').length,
    bloqueados: marcas.filter((marca) => marca === '!').length,
    total: marcas.length,
  }
}
