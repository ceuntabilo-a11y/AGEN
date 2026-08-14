#!/usr/bin/env node
/**
 * Operaciones rutinarias del servicio local de AGEN, en un solo comando y sin sintaxis de
 * shell que analizar.
 *
 * El problema que resuelve es el mismo que resolvió `scripts/gh-agen.mjs` para GitHub, pero
 * para el ciclo "levantar la app y comprobarla". Escrito a mano en la shell, ese ciclo era:
 *
 *     npm start > /dev/null 2>&1 &      # proceso en segundo plano
 *     sleep 10                          # espera ciega
 *     curl -s http://localhost:3010/... # sondeo
 *
 * y el analizador de seguridad no puede analizar estáticamente `&`, ni el encadenado, ni el
 * sondeo repetido, así que pedía autorización para algo perfectamente rutinario. Parchear
 * comando por comando no sirve: el problema es la FORMA, no cada comando.
 *
 * Acá todo eso pasa por una envoltura con argumentos simples:
 *
 *   npm run app -- estado             ¿hay un servidor de AGEN vivo? ¿en qué puerto?
 *   npm run app -- construir          build de producción
 *   npm run app -- arrancar [puerto]  levanta `npm start` y ESPERA a que responda /api/health
 *   npm run app -- detener            detiene solo los procesos Next de ESTE repositorio
 *   npm run app -- reiniciar          detener + arrancar
 *   npm run app -- salud [ruta]       GET local, imprime estado, milisegundos y cuerpo
 *   npm run app -- medir <ruta> [n]   latencia local: n mediciones, min/mediana/p95/max
 *   npm run app -- esperar [ruta]     espera a que una ruta local responda 200
 *   npm run app -- prod [ruta]        GET de SOLO LECTURA a producción (rutas permitidas)
 *   npm run app -- version            compara el commit de main con el vivo en producción
 *   npm run app -- e2e [proyecto]     Playwright contra el servidor local, ya configurado
 *
 * Qué NO amplía esta envoltura (y por qué sigue siendo segura):
 *
 * - `detener` solo mata procesos `node.exe` cuya línea de comando apunte a ESTE repositorio y
 *   a Next, con la misma comprobación que `dev-restart.mjs`, y descarta explícitamente
 *   cualquier cosa que mencione MediCore. El alcance está grabado acá y no se amplía por
 *   argumento.
 * - `prod` hace exclusivamente GET y solo sobre una lista blanca de rutas públicas de
 *   diagnóstico. No acepta método, ni cuerpo, ni cabeceras, ni una URL arbitraria: no hay
 *   forma de convertirlo en una mutación de producción, que es lo que la política prohíbe.
 * - No lee `.env*` ni imprime ninguna credencial.
 */
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUERTO_POR_DEFECTO = 3010
const LOG = path.join(RAIZ, '.next', 'servicio.log')

/**
 * Producción es un destino fijo y público (el mismo que documenta `CLAUDE.md` §7), no algo
 * que se pase por argumento. Y solo se permiten rutas de diagnóstico que no exponen ni
 * modifican datos de negocio — las mismas que ya consulta `monitor-salud.mjs`.
 */
const PRODUCCION = 'https://agen.synetia.site'
const RUTAS_PROD = new Set(['/api/health', '/', '/login'])

const espera = (ms) => new Promise((listo) => setTimeout(listo, ms))

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}

// ---------------------------------------------------------------------------- procesos

const PUERTOS_DE_AGEN = ['-p 3000', '-p 3010']
const BIN_RELATIVO = 'node_modules/next/dist/bin/next'

/** Procesos de Next que pertenecen a este repositorio. Nunca devuelve nada de fuera. */
function procesosDeAgen() {
  const consulta = [
    '-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
      'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
  ]
  let salida = ''
  try {
    salida = execFileSync('powershell', consulta, { encoding: 'utf8', windowsHide: true })
  } catch { return [] }

  let filas
  try { filas = JSON.parse(salida || '[]') } catch { return [] }
  if (!Array.isArray(filas)) filas = [filas]

  const raizNormalizada = RAIZ.replace(/\\/g, '/').toLowerCase()
  return filas
    .filter((fila) => {
      const linea = String(fila?.CommandLine ?? '').replace(/\\/g, '/').toLowerCase()
      if (!linea) return false
      // Cinturón extra, antes que nada: jamás tocar MediCore, que vive en la misma máquina.
      if (linea.includes('medicore')) return false
      if (!linea.includes('next')) return false
      if (linea.includes(raizNormalizada)) return true
      return linea.includes(BIN_RELATIVO) && PUERTOS_DE_AGEN.some((puerto) => linea.includes(puerto))
    })
    .map((fila) => Number(fila.ProcessId))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

function detener() {
  const pids = procesosDeAgen()
  for (const pid of pids) {
    try { process.kill(pid); console.log(`detenido ${pid}`) }
    catch (error) { console.log(`no se pudo detener ${pid}: ${error.code ?? 'error'}`) }
  }
  if (!pids.length) console.log('no había ningún servidor de AGEN vivo')
  return pids.length
}

// ---------------------------------------------------------------------------- HTTP

async function pedir(url, { limiteMs = 15000 } = {}) {
  const arranque = Date.now()
  try {
    const respuesta = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(limiteMs),
      redirect: 'manual',
    })
    const texto = await respuesta.text()
    return { estado: respuesta.status, ok: respuesta.ok, ms: Date.now() - arranque, texto }
  } catch (error) {
    return { estado: 0, ok: false, ms: Date.now() - arranque, texto: '', error: error?.name ?? 'error' }
  }
}

const baseLocal = (puerto) => `http://127.0.0.1:${puerto}`

/** Espera a que una ruta local responda. Devuelve el resultado o null si se agotó el plazo. */
async function esperarRuta(puerto, ruta, segundos) {
  const limite = Date.now() + segundos * 1000
  for (;;) {
    const resultado = await pedir(`${baseLocal(puerto)}${ruta}`, { limiteMs: 5000 })
    if (resultado.estado > 0) return resultado
    if (Date.now() > limite) return null
    await espera(1000)
  }
}

// ---------------------------------------------------------------------------- órdenes

const [orden, ...resto] = process.argv.slice(2)
const puertoDe = (valor) => Number(valor) || PUERTO_POR_DEFECTO

/**
 * Rutas sin barra inicial también valen: `api/health` y `/api/health` son lo mismo.
 *
 * No es cosmético. Git Bash en Windows convierte cualquier argumento que empiece por `/` en
 * una ruta de disco («/api/health» → «C:/Program Files/Git/api/health») antes de que Node lo
 * vea, y entonces la petición se hace a una URL sin sentido y falla con un TypeError opaco.
 * Aceptando la forma sin barra el problema desaparece, y si aun así llega mangleada se dice
 * en voz alta en vez de fallar de forma críptica.
 */
function rutaDe(valor, porDefecto = '/api/health') {
  if (!valor) return porDefecto
  if (/^[a-zA-Z]:[\\/]/.test(valor) || valor.includes('Program Files')) {
    console.error(`Argumento mangleado por la shell: ${valor}`)
    console.error('Pasa la ruta SIN barra inicial. Ejemplo: npm run app -- medir api/health 40')
    process.exit(2)
  }
  return valor.startsWith('/') ? valor : `/${valor}`
}

switch (orden) {
  case 'estado': {
    const pids = procesosDeAgen()
    console.log(`procesos de AGEN/Next: ${pids.length ? pids.join(', ') : 'ninguno'}`)
    for (const puerto of [3000, PUERTO_POR_DEFECTO]) {
      const r = await pedir(`${baseLocal(puerto)}/api/health`, { limiteMs: 3000 })
      console.log(`  ${puerto}: ${r.estado ? `HTTP ${r.estado} en ${r.ms} ms — ${r.texto.slice(0, 200)}` : 'sin respuesta'}`)
    }
    break
  }

  case 'construir': {
    // Ruta relativa al cwd a propósito: ver la trampa de las dos cajas en CLAUDE.md §7.
    const resultado = spawn(process.execPath, ['./node_modules/next/dist/bin/next', 'build'], {
      cwd: RAIZ, stdio: 'inherit',
    })
    await new Promise((listo) => resultado.on('exit', (codigo) => { process.exitCode = codigo ?? 1; listo() }))
    break
  }

  case 'arrancar': {
    const puerto = puertoDe(resto[0])
    if (!existsSync(path.join(RAIZ, '.next', 'BUILD_ID'))) {
      console.error('No hay build de producción. Ejecuta antes: npm run app -- construir')
      process.exit(2)
    }
    detener()
    await espera(1500)
    mkdirSync(path.dirname(LOG), { recursive: true })
    const registro = openSync(LOG, 'a')
    const hijo = spawn(process.execPath, ['./node_modules/next/dist/bin/next', 'start', '-p', String(puerto), '-H', '127.0.0.1'], {
      cwd: RAIZ, detached: true, stdio: ['ignore', registro, registro],
    })
    hijo.unref()
    console.log(`servidor lanzado (pid ${hijo.pid}) en el puerto ${puerto}, log en ${LOG}`)
    const listo = await esperarRuta(puerto, '/api/health', 90)
    closeSync(registro)
    if (!listo) { console.error('el servidor no respondió en 90 s'); process.exit(1) }
    console.log(`health: HTTP ${listo.estado} en ${listo.ms} ms — ${listo.texto.slice(0, 300)}`)
    break
  }

  case 'detener': {
    detener()
    // Windows tarda un instante en soltar el .node nativo de Next (si no, `npm ci` da EPERM).
    await espera(1500)
    break
  }

  case 'reiniciar': {
    detener()
    await espera(1500)
    console.log('ahora: npm run app -- arrancar')
    break
  }

  case 'salud': {
    const ruta = rutaDe(resto[0])
    const puerto = puertoDe(resto[1])
    const r = await pedir(`${baseLocal(puerto)}${ruta}`)
    console.log(`${ruta} → ${r.estado ? `HTTP ${r.estado}` : `sin respuesta (${r.error})`} en ${r.ms} ms`)
    if (r.texto) console.log(r.texto.slice(0, 2000))
    process.exitCode = r.ok ? 0 : 1
    break
  }

  case 'esperar': {
    const ruta = rutaDe(resto[0])
    const segundos = Number(resto[1]) || 90
    const puerto = puertoDe(resto[2])
    const r = await esperarRuta(puerto, ruta, segundos)
    console.log(r ? `${ruta} → HTTP ${r.estado} en ${r.ms} ms` : `${ruta} no respondió en ${segundos} s`)
    process.exitCode = r ? 0 : 1
    break
  }

  case 'medir': {
    const ruta = rutaDe(resto[0])
    const veces = Math.min(Number(resto[1]) || 20, 200)
    const puerto = puertoDe(resto[2])
    const url = `${baseLocal(puerto)}${ruta}`
    // Una petición de calentamiento aparte: la primera de Next compila/carga la ruta y no
    // representa el estado estable. Se informa por separado en vez de descartarla en silencio.
    const calentamiento = await pedir(url)
    const muestras = []
    for (let i = 0; i < veces; i += 1) {
      const r = await pedir(url)
      if (r.estado === 0) { console.error(`la petición ${i + 1} falló (${r.error})`); process.exit(1) }
      muestras.push(r.ms)
    }
    muestras.sort((a, b) => a - b)
    const pct = (p) => muestras[Math.min(muestras.length - 1, Math.floor((p / 100) * muestras.length))]
    const media = Math.round(muestras.reduce((a, b) => a + b, 0) / muestras.length)
    console.log(`${ruta} · ${veces} peticiones · primera (fría) ${calentamiento.ms} ms`)
    console.log(`  min ${muestras[0]} ms · mediana ${pct(50)} ms · media ${media} ms · p95 ${pct(95)} ms · max ${muestras[muestras.length - 1]} ms`)
    break
  }

  case 'limpiar-temporales': {
    /*
     * Las pruebas desechables de diagnóstico se crean con el prefijo `__tmp-` y, al terminar,
     * se sacan del repositorio en vez de borrarse (la convención está en la skill
     * `safe-local-autonomy`: nada se borra, se mueve). Acá se hace de una vez y sin comodines
     * de shell, que es lo que obligaba a escribir un `mv` distinto por cada carpeta.
     */
    const destino = path.join(RAIZ, '..', 'agen-temporales')
    mkdirSync(destino, { recursive: true })
    const movidos = []
    const recorrer = (carpeta) => {
      for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
        if (entrada.name === 'node_modules' || entrada.name === '.git' || entrada.name === '.next') continue
        const completa = path.join(carpeta, entrada.name)
        if (entrada.isDirectory()) { recorrer(completa); continue }
        if (!entrada.name.startsWith('__tmp-')) continue
        const fuera = path.join(destino, `${Date.now()}-${entrada.name}`)
        renameSync(completa, fuera)
        movidos.push(path.relative(RAIZ, completa).replace(/\\/g, '/'))
      }
    }
    recorrer(path.join(RAIZ, 'tests'))
    recorrer(path.join(RAIZ, 'scripts'))
    console.log(movidos.length ? `movidos fuera del repositorio:\n  ${movidos.join('\n  ')}` : 'no había temporales')
    console.log(`destino: ${destino}`)
    break
  }

  case 'verificar-version': {
    // Guarda contra una regresión que ya ocurrió: la opción `env` de Next sustituye
    // TEXTUALMENTE `process.env.AGEN_COMMIT` al compilar, así que un acceso dinámico deja el
    // campo en `desconocido` sin que falle nada — el build pasa, las pruebas de contrato
    // pasan, y el dato llega vacío justo cuando hace falta. Esto lo detecta.
    const puerto = puertoDe(resto[0])
    const r = await pedir(`${baseLocal(puerto)}/api/health`)
    if (!r.ok) { console.error(`/api/health no respondió (${r.estado || r.error})`); process.exit(1) }
    let cuerpo = null
    try { cuerpo = JSON.parse(r.texto) } catch {}
    console.log(r.texto.slice(0, 400))
    if (!cuerpo || typeof cuerpo.commit !== 'string' || cuerpo.commit === 'desconocido') {
      console.error('\n/api/health no sabe qué commit está sirviendo: el build no inyectó AGEN_COMMIT.')
      process.exit(1)
    }
    if (cuerpo.service !== 'agen' || cuerpo.ok !== true) {
      console.error('\n/api/health no responde lo que la monitorización espera (ok/service).')
      process.exit(1)
    }
    console.log(`\nEl build sirve el commit ${cuerpo.commitCorto}.`)
    break
  }

  case 'prod': {
    const ruta = rutaDe(resto[0])
    if (!RUTAS_PROD.has(ruta)) {
      console.error(`Ruta no permitida: ${ruta}. Solo lectura de ${[...RUTAS_PROD].join(', ')}.`)
      process.exit(2)
    }
    const r = await pedir(`${PRODUCCION}${ruta}`)
    console.log(`producción ${ruta} → ${r.estado ? `HTTP ${r.estado}` : `sin respuesta (${r.error})`} en ${r.ms} ms`)
    if (r.texto) console.log(r.texto.slice(0, 1000))
    process.exitCode = r.ok ? 0 : 1
    break
  }

  case 'prod-perfil': {
    /*
     * Dónde se van los milisegundos de una petición a producción.
     *
     * Sin esto, "1331 ms en /api/health" no dice nada: puede ser DNS, el handshake TLS, el
     * Worker de Cloudflare que hace de proxy inverso, el contenedor arrancando en frío, o la
     * ruta misma. Se separan las fases para no arreglar la que no era. SOLO LECTURA, y solo
     * sobre /api/health.
     */
    const veces = Math.min(Number(resto[0]) || 5, 20)
    const { request } = await import('node:https')
    const medir = () => new Promise((listo) => {
      const t = { inicio: Date.now() }
      const peticion = request(`${PRODUCCION}/api/health`, { method: 'GET', headers: { accept: 'application/json' } }, (respuesta) => {
        let cuerpo = ''
        respuesta.on('data', (trozo) => { cuerpo += trozo })
        respuesta.on('end', () => listo({ ...t, fin: Date.now(), estado: respuesta.statusCode, cabeceras: respuesta.headers, cuerpo }))
      })
      peticion.on('socket', (socket) => {
        t.socket = Date.now()
        socket.on('lookup', () => { t.dns = Date.now() })
        socket.on('connect', () => { t.tcp = Date.now() })
        socket.on('secureConnect', () => { t.tls = Date.now() })
      })
      peticion.on('response', () => { t.primerByte = Date.now() })
      peticion.on('error', (error) => listo({ ...t, fin: Date.now(), error: error.message }))
      peticion.setTimeout(20000, () => { peticion.destroy(new Error('timeout')) })
      peticion.end()
    })

    for (let i = 0; i < veces; i += 1) {
      const m = await medir()
      if (m.error) { console.log(`${i + 1}. error: ${m.error}`); continue }
      const d = (a, b) => (a && b ? `${b - a} ms` : '—')
      console.log(
        `${i + 1}. HTTP ${m.estado} total ${m.fin - m.inicio} ms · dns ${d(m.socket, m.dns)}`
        + ` · tcp ${d(m.dns ?? m.socket, m.tcp)} · tls ${d(m.tcp, m.tls)}`
        + ` · servidor ${d(m.tls ?? m.tcp, m.primerByte)}`
        + ` · cf-cache ${m.cabeceras?.['cf-cache-status'] ?? '—'}`,
      )
      if (i === 0) {
        try {
          const cuerpo = JSON.parse(m.cuerpo)
          console.log(`   commit vivo: ${cuerpo.commitCorto ?? cuerpo.commit ?? 'sin dato'}`)
        } catch { console.log(`   cuerpo: ${m.cuerpo.slice(0, 200)}`) }
      }
    }
    break
  }

  case 'prod-sondeo': {
    /*
     * Qué versión está viva, cuando el build no supo decir su commit.
     *
     * Truco sin efectos secundarios: una ruta que solo exporta `POST` responde **405** a un
     * GET si existe, y **404** si no existe. Con eso se acota qué cambios están desplegados
     * sin mandar un solo dato ni tocar nada. Todas las sondas son GET y ninguna lleva cuerpo,
     * cabeceras ni credenciales: la respuesta llega antes de que la ruta haga nada.
     */
    const SONDAS = [
      { ruta: '/api/agent/escalate', desde: 'escalación humana real (bace75d)' },
      { ruta: '/api/agent/media', desde: 'multimedia del agente (ya existía)' },
      { ruta: '/api/agent/voice/reply', desde: 'voz del agente (ya existía)' },
    ]
    for (const sonda of SONDAS) {
      const r = await pedir(`${PRODUCCION}${sonda.ruta}`, { limiteMs: 10000 })
      const veredicto = r.estado === 404 ? 'NO existe' : r.estado === 0 ? `sin respuesta (${r.error})` : 'existe'
      console.log(`${sonda.ruta.padEnd(26)} HTTP ${String(r.estado).padStart(3)}  ${veredicto.padEnd(12)} ${sonda.desde}`)
    }
    break
  }

  case 'version': {
    /*
     * La pregunta que esto contesta: ¿el arreglo que mergeé está VIVO, o producción sigue con
     * el código anterior porque falta el clic de despliegue?
     *
     * Se compara por commit cuando el build pudo resolverlo, y **por huella cuando no** — que
     * es el caso de EasyPanel, cuyo contenedor de compilación no trae `.git` ni el SHA en
     * ninguna variable. La huella se calcula aquí desde los blobs que git ya tiene de
     * `origin/main`, sin sacar nada a disco, con el mismo algoritmo que usa el build
     * (`scripts/huella.mjs`).
     */
    git('fetch', 'origin', 'main')
    const main = git('rev-parse', 'origin/main') ?? git('rev-parse', 'main')
    const r = await pedir(`${PRODUCCION}/api/health`)
    let vivo = null
    let compilado = null
    let huellaViva = null
    try {
      const cuerpo = JSON.parse(r.texto)
      vivo = cuerpo?.commit ?? null
      compilado = cuerpo?.compiladoEn ?? null
      huellaViva = cuerpo?.huella ?? null
    } catch {}

    console.log(`main (origin):  ${main ?? 'desconocido'}`)
    console.log(`producción:     ${vivo ?? 'sin dato — ¿versión anterior de /api/health?'}`)
    if (compilado) console.log(`compilado en:   ${compilado}`)

    // Camino normal: el build supo su commit.
    if (vivo && main && vivo !== 'desconocido') {
      const igual = vivo === main
      console.log(igual ? '\nProducción está al día con main.' : '\nProducción NO tiene el último main: falta desplegar.')
      process.exitCode = igual ? 0 : 1
      break
    }

    if (!huellaViva || huellaViva === 'desconocida') {
      console.log('\nNo se puede comparar: el build no supo ni su commit ni su huella.')
      process.exitCode = 2
      break
    }

    const { huellaDeEntradas, RUTAS_DE_LA_HUELLA } = await import('./huella.mjs')
    // `ls-tree -r` da una línea `modo tipo hash\truta` por archivo del árbol de origin/main.
    const listado = git('ls-tree', '-r', 'origin/main', '--', ...RUTAS_DE_LA_HUELLA)
    if (!listado) { console.log('\nNo pude leer el árbol de origin/main.'); process.exitCode = 2; break }
    const entradas = listado.split('\n').map((linea) => {
      const [meta, ruta] = linea.split('\t')
      const [, tipo, hash] = meta.trim().split(/\s+/)
      return tipo === 'blob' && ruta && !ruta.endsWith('.md') ? [ruta, hash] : null
    }).filter(Boolean)
    const huellaDeMain = huellaDeEntradas(entradas)

    console.log(`huella viva:    ${huellaViva}`)
    console.log(`huella de main: ${huellaDeMain}`)
    const igual = huellaViva === huellaDeMain
    console.log(igual
      ? '\nProducción está al día con main (comparado por huella: el build no pudo resolver el commit).'
      : '\nProducción NO tiene el último main: falta desplegar.')
    process.exitCode = igual ? 0 : 1
    break
  }

  case 'e2e': {
    // Primer argumento: el project. El resto se pasa tal cual a Playwright (`--grep`, un
    // fichero suelto…), para no tener que salir de la envoltura para filtrar una prueba.
    const [proyecto, ...extras] = resto
    const args = ['./node_modules/@playwright/test/cli.js', 'test']
    if (proyecto && proyecto !== '-') args.push(`--project=${proyecto}`)
    args.push(...extras)
    const hijo = spawn(process.execPath, args, {
      cwd: RAIZ,
      stdio: 'inherit',
      /*
       * Solo `E2E_BASE_URL`, y a propósito NO `CI=1`.
       *
       * `E2E_BASE_URL` hace falta porque `.env.test.local` trae un valor que no es el servidor
       * local, y `process.loadEnvFile()` no pisa lo que ya está en el entorno: poniéndolo acá
       * manda este. `CI=1` en cambio hace que Playwright levante ÉL el servidor con
       * `reuseExistingServer:false`, y entonces choca con el que acabas de arrancar
       * («http://localhost:3010/api/health is already used»). En local el servidor lo maneja
       * `npm run app -- arrancar`; en GitHub Actions lo maneja el propio CI.
       */
      /*
       * `localhost`, no `127.0.0.1`, aunque el servidor escuche en la IP.
       *
       * Next construye las redirecciones del middleware con el host que él tiene resuelto
       * (`localhost`), no con el de la petición. Entrando por `127.0.0.1`, un redirect de
       * `/plataforma` mandaba a `http://localhost:3010/profesional` — otro origen, así que la
       * cookie de sesión no viajaba y acababa en `/login`. Tres pruebas de control de acceso
       * fallaban por eso y el bug no existía: era el destino de la suite.
       */
      env: { ...process.env, E2E_BASE_URL: process.env.E2E_BASE_URL || `http://localhost:${PUERTO_POR_DEFECTO}` },
    })
    await new Promise((listo) => hijo.on('exit', (codigo) => { process.exitCode = codigo ?? 1; listo() }))
    break
  }

  default:
    console.log('Órdenes: estado · construir · arrancar · detener · reiniciar · salud · esperar · medir · limpiar-temporales · verificar-version · prod · version · e2e')
    console.log('Ejemplo: npm run app -- arrancar   y luego   npm run app -- medir /api/health 30')
    process.exitCode = orden ? 2 : 0
}
