import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

/**
 * Las dos envolturas que permiten trabajar sin diálogos de aprobación: `npm run gh` para
 * GitHub y `npm run app` para el servicio local.
 *
 * Existen porque el analizador de seguridad no puede analizar estáticamente `&`, `sleep`,
 * tuberías, sustituciones ni texto multilínea dentro del comando, y por tanto pedía
 * autorización para operaciones perfectamente rutinarias. Cada vez que se ha reintroducido una
 * de esas formas, la autonomía se ha roto otra vez.
 *
 * Estas pruebas fijan las dos mitades del trato:
 *
 * 1. que las envolturas cubran la operación rutinaria sin obligar a volver a la forma peligrosa;
 * 2. que **no amplíen** lo que se puede hacer — nada de saltarse el CI, la protección de rama,
 *    ni convertir una consulta a producción en una mutación.
 */

const RAIZ = path.resolve(__dirname, '..', '..')
const GH = path.join(RAIZ, 'scripts', 'gh-agen.mjs')
const APP = path.join(RAIZ, 'scripts', 'servicio.mjs')
const GIT = path.join(RAIZ, 'scripts', 'git-agen.mjs')
const fuente = (ruta: string) => readFileSync(ruta, 'utf8')

/**
 * Solo el código que se ejecuta.
 *
 * Los comentarios de estas envolturas nombran a propósito lo que NO hacen («nunca pasa
 * --admin, --auto»), así que buscar esas cadenas en el archivo entero daría un falso positivo
 * justo por documentarlo bien.
 */
const codigoEjecutable = (ruta: string) =>
  fuente(ruta).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')

/** Ejecuta una envoltura y devuelve código de salida y salida, sin lanzar. */
function correr(script: string, args: string[]): { codigo: number; salida: string } {
  try {
    const salida = execFileSync(process.execPath, [script, ...args], {
      cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
    })
    return { codigo: 0, salida }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { codigo: e.status ?? 1, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

test.describe('npm run gh: cuerpos largos sin texto multilínea en el comando', () => {
  test('pr-crear rechaza un cuerpo multilínea y dice qué usar en su lugar', () => {
    // Este es el incidente que se está fijando: el markdown del PR escrito dentro del comando
    // vuelve a disparar el diálogo. Se corta antes de llamar a gh.
    const { codigo, salida } = correr(GH, ['pr-crear', 'un título', 'línea 1\nlínea 2'])
    expect(codigo).toBe(2)
    expect(salida).toContain('pr-crear-md')
  })

  test('pr-crear-md sin archivo explica dónde escribirlo, no falla de forma críptica', () => {
    const { codigo, salida } = correr(GH, ['pr-crear-md', '.pr/no-existe-jamas.md'])
    expect(codigo).toBe(2)
    expect(salida).toContain('primera línea')
  })

  test('el cuerpo llega a gh por archivo, nunca como argumento', () => {
    // Un markdown largo como argumento choca con el límite de línea de comando de Windows y,
    // sobre todo, obliga a escribirlo dentro del comando.
    const codigo = codigoEjecutable(GH)
    expect(codigo).toContain('--body-file')
    expect(codigo).not.toContain("'--body',")
  })

  test('los borradores de PR no pueden colarse en un commit', () => {
    expect(fuente(path.join(RAIZ, '.gitignore'))).toContain('/.pr/')
  })
})

test.describe('npm run gh: no amplía lo que se puede hacer', () => {
  const codigo = codigoEjecutable(GH)

  test('nunca se salta la protección de rama ni el CI', () => {
    for (const atajo of ['--admin', '--auto', '--force']) expect(codigo).not.toContain(atajo)
  })

  test('mergear exige los checks en verde y no hay argumento para desactivarlo', () => {
    expect(codigo).toContain('no están todos en verde')
    // `todosVerdes` es la única puerta: si alguien añadiera un `--sin-checks`, esto lo vería.
    expect(codigo).not.toMatch(/sin-?checks|saltar|skip-?checks/i)
  })

  test('no existe ninguna orden destructiva', () => {
    for (const destructiva of ['repo delete', 'pr close', 'run delete', 'secret', 'ruleset']) {
      expect(codigo).not.toContain(destructiva)
    }
  })
})

test.describe('npm run git: el ciclo git rutinario, entero y sin poder perder trabajo', () => {
  const codigo = codigoEjecutable(GIT)

  test('cubre el ciclo completo, incluido poner main al día después de mergear', () => {
    // Si falta un paso, se sale de la envoltura para ese paso — y ahí vuelve el diálogo.
    // `actualizar-main` era justo el hueco: tras mergear un PR, `main` local queda por detrás,
    // `cambiar main` se niega con razón y no había forma de adelantarlo desde acá.
    const { salida } = correr(GIT, [])
    for (const orden of ['estado', 'crear-rama', 'cambiar', 'traer', 'add', 'commit', 'subir', 'sincronizar', 'actualizar-main', 'integrar-main']) {
      expect(salida, `falta la orden "${orden}"`).toContain(orden)
    }
  })

  test('no existe ninguna orden que pueda perder trabajo', () => {
    for (const destructiva of ['reset', 'clean', 'restore', 'stash', 'rebase', 'filter-branch', '--force', '--hard', '-D']) {
      expect(codigo, `"${destructiva}" no puede estar en la envoltura`).not.toContain(destructiva)
    }
  })

  test('adelantar main no reescribe nada: solo avanza si es un avance directo', () => {
    // `fetch origin main:main` y `merge --ff-only` fallan en vez de descartar commits. Sin
    // esto, "poner main al día" sería un `reset --hard` con otro nombre.
    expect(codigo).toContain("'main:main'")
    expect(codigo).toContain('--ff-only')
  })

  test('subir nunca empuja a main ni acepta refspecs', () => {
    expect(codigo).toContain('No se empuja directamente a main')
    const { codigo: salidaCodigo, salida } = correr(GIT, ['crear-rama', 'main'])
    expect(salidaCodigo).toBe(2)
    expect(salida).toContain('No se trabaja directamente sobre main')
  })
})

test.describe('npm run app: el ciclo local sin sintaxis peligrosa', () => {
  const codigo = codigoEjecutable(APP)

  test('cubre todo el ciclo que antes se escribía a mano', () => {
    for (const orden of ['arrancar', 'esperar', 'salud', 'medir', 'detener', 'construir', 'e2e']) {
      expect(codigo).toContain(`case '${orden}'`)
    }
  })

  test('detener solo alcanza a procesos Next de este repositorio, nunca a MediCore', () => {
    expect(codigo).toContain("linea.includes('medicore')")
    expect(codigo).toContain('raizNormalizada')
  })

  test('producción es solo lectura y sobre una lista blanca de rutas', () => {
    expect(codigo).toContain("RUTAS_PROD = new Set(['/api/health', '/', '/login'])")
    // Ni método, ni cuerpo, ni cabeceras arbitrarias: no hay forma de convertirlo en mutación.
    expect(codigo).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/)
    expect(codigo).not.toMatch(/body:\s*/)
  })

  test('prod rechaza cualquier ruta fuera de la lista', () => {
    const { codigo: salida, salida: texto } = correr(APP, ['prod', 'api/admin/agenda'])
    expect(salida).toBe(2)
    expect(texto).toContain('no permitida')
  })

  test('una ruta mangleada por Git Bash se dice en voz alta en vez de fallar críptico', () => {
    // Git Bash convierte «/api/health» en «C:/Program Files/Git/api/health» antes de que Node
    // lo vea. Sin este aviso el síntoma era un TypeError sin explicación.
    const { codigo: salida, salida: texto } = correr(APP, ['medir', 'C:/Program Files/Git/api/health'])
    expect(salida).toBe(2)
    expect(texto).toContain('SIN barra inicial')
  })

  test('arrancar exige un build previo en vez de dejar el servidor a medias', () => {
    expect(codigo).toContain('BUILD_ID')
  })
})
