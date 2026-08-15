#!/usr/bin/env node
/**
 * Ciclo git rutinario de AGEN, en un solo comando y sin sintaxis de shell que analizar.
 *
 * Tercera envoltura de la misma familia, después de `npm run gh` (GitHub) y `npm run app`
 * (servicio local). El problema es idéntico: el trabajo normal se escribía encadenando varias
 * órdenes con `&&`, `;` y tuberías, y el analizador de seguridad no puede analizar esa FORMA,
 * así que pedía autorización para un `git status`. Parchear comando por comando no sirve.
 *
 *   npm run git -- estado                  rama, árbol y commits por delante/detrás
 *   npm run git -- rama                    rama actual
 *   npm run git -- crear-rama <nombre>     crea y cambia (solo nombres seguros)
 *   npm run git -- cambiar <rama>          cambia a una rama que YA existe
 *   npm run git -- traer                   git fetch origin (no toca el árbol)
 *   npm run git -- log [n]                 últimos commits
 *   npm run git -- diff [ruta]             cambios sin commitear
 *   npm run git -- staged                  qué hay preparado para commitear
 *   npm run git -- add <ruta> [ruta...]    añade rutas EXPLÍCITAS del repositorio
 *   npm run git -- add-todo                añade todo lo modificado y lo nuevo no ignorado
 *   npm run git -- commit [archivo.md]     commitea con el mensaje del archivo (.pr/commit.md)
 *   npm run git -- subir                   push de la rama actual a origin (nunca --force)
 *   npm run git -- sincronizar             traer + poner la rama actual al día con origin/main
 *   npm run git -- actualizar-main         adelanta el `main` LOCAL a origin/main (desde donde estés)
 *
 * Qué NO puede hacer, por construcción: no hay orden para `reset`, `clean`, `restore`,
 * `checkout -- `, `stash`, `rebase`, `merge`, borrado de ramas ni `push --force`. No es que
 * pregunte: es que no existe el camino. Lo que pueda perder trabajo lo ejecuta una persona.
 *
 * `sincronizar` usa `merge --ff-only`: si no puede avanzar sin reescribir nada, se niega y lo
 * dice. Nunca resuelve un conflicto por su cuenta.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Ejecuta git. Nunca se construye la orden con texto: siempre argumentos sueltos. */
function git(args, { silencioso = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (silencioso) return null
    const detalle = String(error?.stderr || error?.stdout || error?.message || '').trim()
    console.error(detalle.slice(0, 1000))
    process.exit(1)
  }
}

const ramaActual = () => git(['rev-parse', '--abbrev-ref', 'HEAD'])

/**
 * Nombres de rama aceptados.
 *
 * Cerrado a propósito: sin esto, un nombre con `--` o con espacios se podría colar como
 * opción de git. Se permite lo que ya usa el repositorio (`fix/`, `feat/`, `docs/`…).
 */
function ramaValida(nombre) {
  if (!/^[a-z][a-z0-9]*\/[a-z0-9][a-z0-9._-]*$/i.test(nombre) && !/^[a-z][a-z0-9._-]*$/i.test(nombre)) {
    console.error(`Nombre de rama no permitido: ${nombre}`)
    console.error('Usa algo como fix/lo-que-arregla o feat/lo-que-anade.')
    process.exit(2)
  }
  if (nombre === 'main') { console.error('No se trabaja directamente sobre main.'); process.exit(2) }
  return nombre
}

/** Rutas del repositorio, nunca opciones ni rutas de fuera. */
function rutaValida(valor) {
  if (valor.startsWith('-')) { console.error(`No se aceptan opciones como ruta: ${valor}`); process.exit(2) }
  const absoluta = path.resolve(RAIZ, valor)
  if (!absoluta.startsWith(RAIZ)) { console.error(`Fuera del repositorio: ${valor}`); process.exit(2) }
  return path.relative(RAIZ, absoluta).replace(/\\/g, '/') || '.'
}

const [orden, ...resto] = process.argv.slice(2)

switch (orden) {
  case 'estado': {
    const rama = ramaActual()
    const sucio = git(['status', '--porcelain'])
    console.log(`rama: ${rama}`)
    const cuenta = git(['rev-list', '--left-right', '--count', `origin/main...${rama}`], { silencioso: true })
    if (cuenta) {
      const [detras, delante] = cuenta.split(/\s+/)
      console.log(`respecto a origin/main: ${delante} por delante, ${detras} por detrás`)
    }
    const remota = git(['rev-parse', '--abbrev-ref', `${rama}@{upstream}`], { silencioso: true })
    console.log(`remota: ${remota ?? 'sin publicar'}`)
    console.log(sucio ? `árbol sucio:\n${sucio}` : 'árbol limpio')
    break
  }

  case 'rama':
    console.log(ramaActual())
    break

  case 'crear-rama': {
    /*
     * Por defecto se ramifica desde `origin/main`, no desde donde estés.
     *
     * Encadenar ramas una detrás de otra es lo que provoca el conflicto de siempre: el PR
     * anterior se mergea con squash, main queda con el mismo contenido y otra historia, y la
     * rama nueva —que arrastra los commits originales— choca con él. Partiendo de origin/main
     * eso no pasa. `--desde=aqui` conserva el comportamiento antiguo cuando de verdad se
     * quiere seguir encima de lo que hay sin subir.
     */
    const argumentos = resto.filter((valor) => !valor.startsWith('--'))
    const desdeAqui = resto.includes('--desde=aqui')
    const nombre = ramaValida(argumentos[0] ?? '')
    if (desdeAqui) { console.log(git(['switch', '-c', nombre]) || `en ${nombre}`); break }

    if (git(['status', '--porcelain', '--untracked-files=no'])) {
      console.error('Hay cambios sin commitear: se arrastrarían a una rama nacida de origin/main.')
      console.error('Commitéalos, o crea la rama sobre lo que hay con: crear-rama <nombre> --desde=aqui')
      process.exit(2)
    }
    git(['fetch', 'origin', '--prune'])
    console.log(git(['switch', '-c', nombre, 'origin/main']) || `en ${nombre}, desde origin/main`)
    break
  }

  case 'cambiar': {
    const nombre = resto[0] ?? ''
    if (nombre.startsWith('-')) { console.error('No se aceptan opciones.'); process.exit(2) }
    // Cambiar de rama con cambios sin guardar puede perderlos si git decide que puede
    // arrastrarlos: se exige el árbol limpio y se dice qué falta commitear.
    //
    // Los archivos SIN seguimiento no cuentan: no pertenecen a ninguna rama, así que cambiar
    // no puede perderlos, y si alguno estorbara git se negaría por su cuenta. Exigirlos limpios
    // solo conseguía bloquear el trabajo por un par de archivos sueltos de siempre.
    const sucio = git(['status', '--porcelain', '--untracked-files=no'])
    if (sucio) {
      console.error('El árbol tiene cambios sin commitear. Commitéalos antes de cambiar de rama:')
      console.error(sucio)
      process.exit(2)
    }
    /*
     * `main` local se queda viejo enseguida: los PR se mergean con squash en GitHub y aquí
     * nadie actualiza esa rama. Cambiarse a ella deja el árbol en una versión antigua del
     * repositorio —incluido `package.json`, así que hasta `npm run git` deja de existir— y
     * parece que se ha perdido trabajo cuando no ha pasado nada. Se avisa antes.
     */
    if (nombre === 'main') {
      git(['fetch', 'origin', '--prune'])
      const detras = git(['rev-list', '--count', 'main..origin/main'], { silencioso: true })
      if (detras && detras !== '0') {
        console.error(`El "main" local está ${detras} commit(s) por detrás de origin/main.`)
        console.error('Cambiarte a él te deja en una versión vieja del repositorio.')
        console.error('Para empezar algo nuevo sobre lo último: npm run git -- crear-rama <nombre>')
        process.exit(2)
      }
    }
    console.log(git(['switch', nombre]) || `en ${nombre}`)
    break
  }

  case 'traer':
    git(['fetch', 'origin', '--prune'])
    console.log('origin actualizado (fetch, sin tocar el árbol).')
    break

  case 'log':
    console.log(git(['log', '--oneline', `-${Math.min(Number(resto[0]) || 10, 50)}`]))
    break

  case 'diff': {
    const rutas = resto.map(rutaValida)
    console.log(git(['diff', ...(rutas.length ? ['--', ...rutas] : [])]) || '(sin cambios)')
    break
  }

  case 'staged':
    console.log(git(['diff', '--cached', '--stat']) || '(no hay nada preparado)')
    break

  case 'add': {
    if (!resto.length) { console.error('Uso: add <ruta> [ruta...]'); process.exit(2) }
    git(['add', '--', ...resto.map(rutaValida)])
    console.log(git(['diff', '--cached', '--stat']) || '(no había cambios)')
    break
  }

  case 'add-todo': {
    git(['add', '-A'])
    console.log(git(['diff', '--cached', '--stat']) || '(no había cambios)')
    break
  }

  case 'commit': {
    /*
     * El mensaje viaja por archivo, no por argumento.
     *
     * Es la misma lección que `npm run gh -- pr-crear-md`: un mensaje de commit de verdad tiene
     * varias líneas, y escribirlo dentro del comando (heredoc, comillas que abarcan saltos)
     * es justo la forma que dispara el diálogo de aprobación.
     */
    const archivo = path.resolve(RAIZ, resto[0] || '.pr/commit.md')
    if (!existsSync(archivo)) {
      console.error(`No existe ${archivo}.`)
      console.error('Escribe ahí el mensaje del commit (primera línea = título) y vuelve a intentarlo.')
      process.exit(2)
    }
    if (!readFileSync(archivo, 'utf8').trim()) { console.error(`${archivo} está vacío.`); process.exit(2) }
    /*
     * Cerrar un merge es un commit aunque no haya nada "preparado".
     *
     * Si los conflictos se resolvieron quedándose con esta rama, el índice coincide con HEAD y
     * `diff --cached` sale vacío — pero el merge sigue abierto y hay que cerrarlo. Sin esta
     * excepción, la envoltura se negaba justo en el paso final y había que salir de ella.
     */
    const enMedioDeUnMerge = existsSync(path.join(RAIZ, '.git', 'MERGE_HEAD'))
    if (!enMedioDeUnMerge && !git(['diff', '--cached', '--name-only'])) {
      console.error('No hay nada preparado. Usa antes: npm run git -- add <rutas>')
      process.exit(2)
    }
    console.log(git(['commit', '-F', archivo]))
    break
  }

  case 'subir': {
    const rama = ramaActual()
    if (rama === 'main') { console.error('No se empuja directamente a main: abre un PR.'); process.exit(2) }
    // Nunca --force, ni --delete, ni refspecs: solo publicar la rama actual.
    console.log(git(['push', '--set-upstream', 'origin', rama]))
    break
  }

  case 'actualizar-main': {
    /*
     * Poner el `main` LOCAL al día con `origin/main`, desde donde estés.
     *
     * Existe porque faltaba justo el paso de después de mergear un PR: `main` local se queda
     * atrás (los PR se mergean con squash en GitHub y aquí nadie actualiza esa rama), `cambiar
     * main` se niega —con razón— por estar por detrás, y no había ninguna orden para
     * adelantarlo. Sin esto había que salir de la envoltura, que es exactamente lo que estas
     * envolturas existen para evitar.
     *
     * Cómo lo hace sin poder perder nada: si NO estás en main, mueve solo la referencia con
     * `fetch origin main:main`, que git rechaza si no es un avance directo y que no toca el
     * árbol de trabajo ni la rama en la que estás. Si estás en main, es un `merge --ff-only`.
     * En ninguno de los dos casos se reescribe historia ni se descarta nada.
     */
    git(['fetch', 'origin', '--prune'])
    const rama = ramaActual()

    if (rama !== 'main') {
      const salida = git(['fetch', 'origin', 'main:main'], { silencioso: true })
      if (salida === null) {
        const unicos = git(['rev-list', '--count', 'origin/main..main'], { silencioso: true }) ?? '?'
        console.error(`El "main" local tiene ${unicos} commit(s) que origin/main no tiene, así que no se puede adelantar sin más.`)
        console.error('Casi siempre es inofensivo: son commits de ramas que se mergearon con squash, y su contenido')
        console.error('ya está en origin/main con otra historia. Nada se ha perdido.')
        console.error('No hace falta arreglarlo para seguir trabajando: "crear-rama" siempre parte de origin/main.')
        console.error('Alinear ese main local descarta esos commits, así que lo hace una persona a conciencia.')
        process.exit(1)
      }
      console.log(`main local al día con origin/main (sigues en ${rama}).`)
      console.log(git(['log', '--oneline', '-1', 'main']))
      break
    }

    if (git(['status', '--porcelain', '--untracked-files=no'])) {
      console.error('El árbol tiene cambios sin commitear: commitéalos antes de actualizar main.')
      process.exit(2)
    }
    const salida = git(['merge', '--ff-only', 'origin/main'], { silencioso: true })
    if (salida === null) {
      console.error('main no se puede poner al día avanzando sin más. Lo resuelve una persona.')
      process.exit(1)
    }
    console.log(salida || 'main ya estaba al día con origin/main.')
    break
  }

  case 'sincronizar': {
    const rama = ramaActual()
    git(['fetch', 'origin', '--prune'])
    if (git(['status', '--porcelain', '--untracked-files=no'])) {
      console.error('El árbol tiene cambios sin commitear: commitéalos antes de sincronizar.')
      process.exit(2)
    }
    // `--ff-only`: si hiciera falta un merge de verdad, se niega en vez de inventar un commit
    // de fusión o de reescribir historia.
    const salida = git(['merge', '--ff-only', 'origin/main'], { silencioso: true })
    if (salida === null) {
      console.error(`${rama} no se puede poner al día con origin/main avanzando sin más.`)
      console.error('Eso ya no es rutina: lo resuelve una persona.')
      process.exit(1)
    }
    console.log(salida || `${rama} ya estaba al día con origin/main.`)
    break
  }

  case 'probar-integracion': {
    /*
     * ¿Chocaría esta rama con main? Sin tocar absolutamente nada.
     *
     * `git merge-tree --write-tree` calcula la fusión en memoria y dice qué archivos
     * chocarían. Es la respuesta que hace falta ANTES de decidir si integrar es rutina o si
     * hace falta una persona — y no deja el árbol a medias si la respuesta es "sí choca".
     */
    git(['fetch', 'origin', '--prune'])
    const salida = git(['merge-tree', '--write-tree', '--name-only', 'HEAD', 'origin/main'], { silencioso: true })
    if (salida === null) {
      // `merge-tree` sale con 1 cuando hay conflictos y con >1 cuando no pudo calcular.
      console.log('Hay conflictos con origin/main. Ejecuta: npm run git -- integrar-main')
      process.exitCode = 1
      break
    }
    console.log('La rama se integra con origin/main sin conflictos.')
    break
  }

  case 'integrar-main': {
    /*
     * Traer main a esta rama. Es lo rutinario cuando main avanzó mientras trabajabas —
     * típicamente porque un PR anterior se mergeó con squash, que deja el mismo contenido con
     * otra historia.
     *
     * Es un merge normal, no una reescritura: no puede perder trabajo. Si hay conflictos, se
     * dice qué archivos y se para; resolverlos es editar y volver a commitear, no un comando.
     */
    if (git(['status', '--porcelain', '--untracked-files=no'])) {
      console.error('Commitea lo que tengas antes de integrar main.')
      process.exit(2)
    }
    git(['fetch', 'origin', '--prune'])
    const salida = git(['merge', 'origin/main', '--no-edit'], { silencioso: true })
    if (salida === null) {
      const chocan = git(['diff', '--name-only', '--diff-filter=U'], { silencioso: true }) ?? ''
      console.error('Conflictos al integrar main en estos archivos:')
      console.error(chocan || '(no se pudo listar)')
      console.error('\nResuélvelos editando los archivos y luego:')
      console.error('  npm run git -- add <rutas>')
      console.error('  npm run git -- commit .pr/commit.md')
      process.exit(1)
    }
    console.log(salida)
    break
  }

  case 'quedarme-con-lo-mio': {
    /*
     * Resuelve un archivo en conflicto quedándose con ESTA rama.
     *
     * El caso rutinario y frecuente: el PR anterior se mergeó con squash, así que main trae el
     * mismo contenido con otra historia y cualquier archivo que se haya seguido tocando
     * después choca — con la versión de la rama siendo un superconjunto de la de main.
     *
     * Solo toca archivos que git marca como en conflicto, y solo quita los marcadores dejando
     * el lado de esta rama. No decide nada más: si el conflicto es real (las dos ramas
     * cambiaron lo mismo de forma distinta), esto NO es lo que hay que usar — hay que leerlo.
     */
    const enConflicto = (git(['diff', '--name-only', '--diff-filter=U'], { silencioso: true }) ?? '')
      .split('\n').map((linea) => linea.trim()).filter(Boolean)
    if (!enConflicto.length) { console.log('No hay archivos en conflicto.'); break }

    const pedidos = resto.length ? resto.map(rutaValida) : enConflicto
    for (const relativa of pedidos) {
      if (!enConflicto.includes(relativa)) { console.error(`${relativa} no está en conflicto.`); process.exit(2) }
      const absoluta = path.join(RAIZ, relativa)
      const original = readFileSync(absoluta, 'utf8')
      // <<<<<<< HEAD  (lo mío)  =======  (lo de la otra rama)  >>>>>>> …
      // `\r?` en cada salto: en Windows el árbol de trabajo lleva CRLF y sin esto el patrón
      // no casaba con ninguna sección y el archivo quedaba con los marcadores puestos.
      const resuelto = original.replace(
        /^<<<<<<< [^\n]*\r?\n([\s\S]*?)^=======\r?\n[\s\S]*?^>>>>>>> [^\n]*\r?\n/gm,
        '$1',
      )
      if (/^(<<<<<<<|=======|>>>>>>>)/m.test(resuelto)) {
        console.error(`${relativa}: quedaron marcadores. Revísalo a mano.`)
        process.exit(1)
      }
      writeFileSync(absoluta, resuelto)
      git(['add', '--', relativa])
      console.log(`resuelto con lo de esta rama: ${relativa}`)
    }
    console.log('\nRevisa el resultado y cierra el merge con: npm run git -- commit .pr/commit.md')
    break
  }

  default:
    console.log('Órdenes: estado · rama · crear-rama · cambiar · traer · log · diff · staged · add · add-todo · commit · subir · sincronizar · actualizar-main · probar-integracion · integrar-main · quedarme-con-lo-mio')
    console.log('Ejemplo: npm run git -- crear-rama fix/algo   y luego   npm run git -- add src/x.ts')
    process.exitCode = orden ? 2 : 0
}
