/**
 * Huella del código que se compila: identifica una versión sin depender de git.
 *
 * Por qué hace falta. `/api/health` sabe decir qué commit sirve, pero solo si el build puede
 * resolverlo — y en EasyPanel **no puede**: el contenedor de compilación no trae `.git` ni
 * ninguna variable con el SHA, así que el commit salía `desconocido` justo donde más falta
 * hacía. Comprobado contra producción el 2026-08-14 después de desplegar: la ruta nueva estaba
 * viva y el commit vacío.
 *
 * La huella contesta la misma pregunta —¿lo que está corriendo es lo que hay en `main`?— sin
 * necesitar nada del entorno: es un hash del contenido de los archivos que deciden el
 * comportamiento de la aplicación.
 *
 * Se calcula igual a los dos lados y por eso se pueden comparar:
 *
 *  - En el BUILD, leyendo los archivos del disco.
 *  - En local, leyendo los blobs que git ya tiene de `origin/main`, sin sacar nada a disco.
 *
 * Para que ambos coincidan se usa exactamente el mismo hash que usa git para un blob
 * (`sha1("blob " + longitud + "\0" + contenido)`) y se normalizan los saltos de línea a LF:
 * en Windows el árbol de trabajo tiene CRLF y git guarda LF, y sin normalizar la huella de la
 * misma versión saldría distinta según el sistema.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Qué entra en la huella: lo que cambia el comportamiento de la aplicación desplegada.
 *
 * Deliberadamente NO entran las pruebas, los scripts de trabajo ni la documentación: cambiarlos
 * no cambia lo que recibe un cliente, y si entraran, la huella diría "hay que desplegar" cada
 * vez que se toca un README.
 */
export const RUTAS_DE_LA_HUELLA = ['src', 'package.json', 'next.config.mjs']

/** Extensiones que se ignoran dentro de `src` (no llegan al comportamiento del servidor). */
const IGNORADAS = new Set(['.md', '.snap'])

const hashDeBlob = (contenido) => {
  // Mismo cálculo que `git hash-object`: así el lado del build y el lado de git coinciden.
  const normalizado = Buffer.from(contenido.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
  return createHash('sha1').update(`blob ${normalizado.length}\0`).update(normalizado).digest('hex')
}

function recorrer(raiz, relativa, salida) {
  const completa = path.join(raiz, relativa)
  let estado
  try { estado = statSync(completa) } catch { return }

  if (estado.isFile()) {
    if (IGNORADAS.has(path.extname(relativa))) return
    salida.push([relativa.replace(/\\/g, '/'), hashDeBlob(readFileSync(completa))])
    return
  }
  if (!estado.isDirectory()) return
  for (const entrada of readdirSync(completa).sort()) {
    recorrer(raiz, path.join(relativa, entrada), salida)
  }
}

/** Huella a partir de los archivos en disco. La usa el build. */
export function huellaDelDisco(raiz) {
  const entradas = []
  for (const ruta of RUTAS_DE_LA_HUELLA) recorrer(raiz, ruta, entradas)
  return huellaDeEntradas(entradas)
}

/** Huella a partir de pares `[ruta, hashDeBlob]`. Es el formato común a los dos lados. */
export function huellaDeEntradas(entradas) {
  const ordenadas = [...entradas].sort((a, b) => a[0].localeCompare(b[0]))
  const resumen = createHash('sha256')
  for (const [ruta, hash] of ordenadas) resumen.update(`${ruta} ${hash}\n`)
  // 16 caracteres: suficiente para que dos versiones distintas no coincidan por accidente, y
  // corto para poder leerlo de un vistazo en una respuesta de salud.
  return resumen.digest('hex').slice(0, 16)
}
