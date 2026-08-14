import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { huellaDeEntradas, huellaDelDisco, RUTAS_DE_LA_HUELLA } from '../../scripts/huella.mjs'

/**
 * La huella del código compilado.
 *
 * Por qué existe, y no es teoría: tras desplegar en EasyPanel, `/api/health` respondía con la
 * ruta nueva pero `commit: "desconocido"`. El contenedor de compilación no trae `.git` ni
 * ninguna variable con el SHA, así que el dato que servía para saber si un arreglo estaba vivo
 * llegaba vacío justo cuando hacía falta.
 *
 * La huella contesta lo mismo sin depender del entorno. Lo único que tiene que cumplir —y es
 * lo que se fija acá— es que **el mismo código dé la misma huella calculada de las dos
 * formas**: desde los archivos del disco (lo que hace el build) y desde los blobs que git ya
 * tiene (lo que hace `npm run app -- version`). Si esas dos se separan, la comparación diría
 * "falta desplegar" para siempre y nadie se fiaría de ella.
 */

const RAIZ = path.resolve(__dirname, '..', '..')

/** Las entradas tal como las lee `npm run app -- version` del árbol de git. */
function entradasDeGit(referencia: string): Array<[string, string]> {
  const salida = execFileSync('git', ['ls-tree', '-r', referencia, '--', ...RUTAS_DE_LA_HUELLA], {
    cwd: RAIZ, encoding: 'utf8',
  }).trim()
  return salida.split('\n').map((linea) => {
    const [meta, ruta] = linea.split('\t')
    const [, tipo, hash] = meta.trim().split(/\s+/)
    return tipo === 'blob' && ruta && !ruta.endsWith('.md') ? [ruta, hash] as [string, string] : null
  }).filter(Boolean) as Array<[string, string]>
}

test.describe('La huella identifica una versión sin necesitar git', () => {
  test('el mismo código da la misma huella desde el disco y desde git', () => {
    // Se compara contra HEAD, no contra el árbol de trabajo, para que el test no dependa de
    // tener cambios sin commitear. Si los hay, se salta con un motivo claro.
    const sucio = execFileSync('git', ['status', '--porcelain', '--untracked-files=no', '--', ...RUTAS_DE_LA_HUELLA], {
      cwd: RAIZ, encoding: 'utf8',
    }).trim()
    test.skip(Boolean(sucio), `hay cambios sin commitear en ${RUTAS_DE_LA_HUELLA.join(', ')}`)

    expect(huellaDelDisco(RAIZ)).toBe(huellaDeEntradas(entradasDeGit('HEAD')))
  })

  test('tiene la forma que la app acepta: 16 hexadecimales', () => {
    expect(huellaDelDisco(RAIZ)).toMatch(/^[0-9a-f]{16}$/)
  })

  test('cambiar un archivo cambia la huella', () => {
    const base = entradasDeGit('HEAD')
    // Se cambia el último carácter por otro distinto: poner siempre '0' no cambia nada cuando
    // el hash ya termina en '0', y la prueba pasaba o fallaba según el contenido del árbol.
    const tocado = base.map(([ruta, hash], indice) => (
      indice === 0 ? [ruta, `${hash.slice(0, -1)}${hash.endsWith('0') ? '1' : '0'}`] : [ruta, hash]
    ) as [string, string])
    expect(huellaDeEntradas(tocado)).not.toBe(huellaDeEntradas(base))
  })

  test('el orden en que se leen los archivos no cambia el resultado', () => {
    const base = entradasDeGit('HEAD')
    expect(huellaDeEntradas([...base].reverse())).toBe(huellaDeEntradas(base))
  })

  test('solo entra lo que cambia el comportamiento desplegado', () => {
    // Si entraran pruebas, scripts o documentación, la huella diría "hay que desplegar" cada
    // vez que se toca un README — y una señal que salta siempre deja de mirarse.
    expect(RUTAS_DE_LA_HUELLA).toEqual(['src', 'package.json', 'next.config.mjs'])
    const rutas = entradasDeGit('HEAD').map(([ruta]) => ruta)
    expect(rutas.some((ruta) => ruta.startsWith('tests/'))).toBe(false)
    expect(rutas.some((ruta) => ruta.startsWith('docs/'))).toBe(false)
    expect(rutas.length).toBeGreaterThan(50)
  })
})
