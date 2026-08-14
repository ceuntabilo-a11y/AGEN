/**
 * Qué versión del código está viva.
 *
 * El problema que resuelve: hasta ahora `/api/health` respondía `{ok:true}` y nada más, así
 * que era imposible saber si un arreglo mergeado en `main` había llegado de verdad al
 * servidor. El despliegue en EasyPanel es un clic manual (ver `CLAUDE.md` §7), de modo que
 * "está en main" y "está desplegado" son dos cosas distintas — y sin este dato cualquier
 * verificación contra producción era una suposición.
 *
 * Cómo se rellena: `next.config.mjs` resuelve el commit EN EL BUILD y lo inyecta como
 * `process.env.AGEN_COMMIT` / `AGEN_COMPILADO`. Se hace al compilar y no en cada petición
 * porque en la imagen que corre puede no existir `.git`, y porque `/api/health` lo consulta la
 * monitorización cada media hora y tiene que ser barato.
 *
 * Qué NO se expone: solo el SHA de un repositorio y una fecha de compilación. Ninguna
 * variable de entorno más, ningún valor de configuración, ninguna credencial. Si el commit no
 * se pudo resolver se responde `desconocido` — nunca se inventa un valor.
 */

/** Solo se leen las dos claves del build; se acepta cualquier mapa para poder probarlo. */
export type Entorno = Record<string, string | undefined>

export const COMMIT_DESCONOCIDO = 'desconocido'

export type VersionDelBuild = {
  /** SHA completo del commit compilado, o `desconocido` si no se pudo resolver. */
  commit: string
  /** SHA corto, el que se compara de un vistazo contra `git log --oneline`. */
  commitCorto: string
  /** ISO-8601 del momento del build, o `null` si no se pudo resolver. */
  compiladoEn: string | null
}

/** Solo hexadecimal de 7 a 40 caracteres cuenta como SHA. Cualquier otra cosa es basura. */
function esSha(valor: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(valor)
}

/**
 * Los dos valores del build, leídos como accesos literales a `process.env`.
 *
 * Tiene que ser literal: `next.config.mjs` los inyecta con la opción `env`, que sustituye
 * **textualmente** `process.env.AGEN_COMMIT` al compilar. Con un acceso dinámico
 * (`entorno.AGEN_COMMIT` sobre `process.env`) no hay nada que sustituir y en el servidor de
 * producción la variable no existe: el commit salía `desconocido` con el build recién hecho.
 * Comprobado, no supuesto — fue exactamente lo que pasó la primera vez.
 */
const ENTORNO_DEL_BUILD: Entorno = {
  AGEN_COMMIT: process.env.AGEN_COMMIT,
  AGEN_COMPILADO: process.env.AGEN_COMPILADO,
}

/**
 * `entorno` se inyecta para poder probar esto sin variables globales. En producción se llama
 * sin argumentos y lee los valores fijados en el build.
 */
export function versionDelBuild(entorno: Entorno = ENTORNO_DEL_BUILD): VersionDelBuild {
  const crudo = (entorno.AGEN_COMMIT ?? '').trim()
  const commit = esSha(crudo) ? crudo.toLowerCase() : COMMIT_DESCONOCIDO
  const compilado = (entorno.AGEN_COMPILADO ?? '').trim()
  return {
    commit,
    commitCorto: commit === COMMIT_DESCONOCIDO ? COMMIT_DESCONOCIDO : commit.slice(0, 7),
    compiladoEn: compilado && !Number.isNaN(Date.parse(compilado)) ? compilado : null,
  }
}

export type CuerpoDeSalud = VersionDelBuild & {
  ok: true
  service: 'agen'
  timestamp: string
}

/**
 * Cuerpo exacto de `/api/health`. Vive acá para que las pruebas puedan comprobar la forma sin
 * levantar el servidor, y para que quede en un solo sitio la garantía de que no se cuela nada
 * más que estos campos.
 */
export function cuerpoDeSalud(
  entorno: Entorno = ENTORNO_DEL_BUILD,
  ahora: Date = new Date(),
): CuerpoDeSalud {
  return {
    ok: true,
    service: 'agen',
    ...versionDelBuild(entorno),
    timestamp: ahora.toISOString(),
  }
}
