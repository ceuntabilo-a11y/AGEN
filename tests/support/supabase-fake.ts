import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * Doble de PostgREST en memoria para probar las rutas REALES de la app sin base de datos.
 *
 * Por qué existe: los riesgos que hay que cubrir acá (dos peticiones concurrentes, un
 * reintento después de un timeout, un webhook duplicado) no se ven en una prueba de UI ni
 * en una llamada suelta al endpoint. Hacen falta dos ejecuciones entrelazadas del MISMO
 * handler, y comprobar que la segunda no produce una segunda mutación.
 *
 * Qué modela y qué no:
 * - Cada petición se atiende en un bloque síncrono, así que un `PATCH … WHERE` evalúa el
 *   filtro y muta sin que se cuele otra petición en el medio. Eso es exactamente lo que
 *   garantiza PostgreSQL en READ COMMITTED para un UPDATE condicional: el segundo espera el
 *   cerrojo de fila y vuelve a evaluar el WHERE contra la versión nueva.
 * - `retardoLectura` retrasa solo las lecturas (GET), que es como se fuerza el entrelazado
 *   clásico "leo, lees, escribo, escribes" que produce el error de doble reclamo.
 * - No modela RLS, ni joins reales (`profesional:professionals(...)` se devuelve tal como
 *   esté en la fila), ni tipos de rango. `overlaps` no filtra: las pruebas ponen en la tabla
 *   solo las filas que la consulta debería ver.
 */

export type Fila = Record<string, any>
export type Tablas = Record<string, Fila[]>
export type LlamadaRpc = { nombre: string; argumentos: Record<string, unknown> }

export type SupabaseFalso = {
  url: string
  tablas: Tablas
  /** Todas las llamadas a `db.rpc(...)`, en orden: sirve para comprobar que NO se repiten. */
  rpc: LlamadaRpc[]
  /** Respuesta (o efecto) de cada función SQL simulada. */
  respuestasRpc: Record<string, (argumentos: any, tablas: Tablas) => unknown>
  /** Peticiones recibidas, para poder afirmar qué se escribió y qué no. */
  peticiones: Array<{ metodo: string; tabla: string; filtros: string; cuerpo: unknown }>
  retardoLectura: number
  /**
   * Columnas que la base todavía no tiene (migración sin aplicar). Escribirlas devuelve el
   * mismo error que PostgREST: así se puede probar el respaldo del código sin migración.
   */
  columnasDesconocidas: string[]
  cerrar: () => Promise<void>
}

const espera = (ms: number) => new Promise((listo) => setTimeout(listo, ms))

/** Convierte el valor de un filtro de PostgREST al tipo con el que está guardado. */
function comparable(valor: string) {
  if (valor === 'null') return null
  if (valor === 'true') return true
  if (valor === 'false') return false
  const sinComillas = valor.replace(/^"(.*)"$/, '$1')
  return sinComillas
}

function mismoValor(fila: unknown, esperado: unknown) {
  if (fila === null || fila === undefined) return esperado === null
  return String(fila) === String(esperado)
}

/** Evalúa un filtro `columna=op.valor` de PostgREST sobre una fila. */
function cumple(fila: Fila, columna: string, expresion: string): boolean {
  const corte = expresion.indexOf('.')
  const operador = corte < 0 ? expresion : expresion.slice(0, corte)
  const resto = corte < 0 ? '' : expresion.slice(corte + 1)
  const valor = fila[columna]

  switch (operador) {
    case 'eq': return mismoValor(valor, comparable(resto))
    case 'neq': return !mismoValor(valor, comparable(resto))
    case 'is': return resto === 'null' ? valor === null || valor === undefined : mismoValor(valor, comparable(resto))
    case 'in': {
      const lista = resto.replace(/^\(|\)$/g, '').split(',').map((item) => comparable(item.trim()))
      return lista.some((item) => mismoValor(valor, item))
    }
    case 'lte': return valor !== null && valor !== undefined && String(valor) <= String(comparable(resto))
    case 'gte': return valor !== null && valor !== undefined && String(valor) >= String(comparable(resto))
    case 'lt': return valor !== null && valor !== undefined && String(valor) < String(comparable(resto))
    case 'gt': return valor !== null && valor !== undefined && String(valor) > String(comparable(resto))
    case 'not': return !cumple(fila, columna, resto)
    // Rangos y búsquedas de texto: la prueba controla qué filas existen, así que no filtran.
    case 'ov': case 'ilike': case 'like': case 'cs': case 'cd': return true
    default: throw new Error(`El doble de PostgREST no entiende el filtro "${columna}=${expresion}"`)
  }
}

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

/** `or=(a.eq.1,b.eq.2)` — se cumple si alguna de las condiciones se cumple. */
function cumpleOr(fila: Fila, expresion: string) {
  return expresion.replace(/^\(|\)$/g, '').split(',').some((condicion) => {
    const corte = condicion.indexOf('.')
    return corte > 0 && cumple(fila, condicion.slice(0, corte), condicion.slice(corte + 1))
  })
}

function filtrar(filas: Fila[], parametros: URLSearchParams) {
  let resultado = filas.filter((fila) =>
    Array.from(parametros.entries()).every(([clave, valor]) =>
      RESERVADOS.has(clave) || (clave === 'or' ? cumpleOr(fila, valor) : cumple(fila, clave, valor))),
  )
  const orden = parametros.get('order')
  if (orden) {
    const claves = orden.split(',').map((item) => {
      const [columna, direccion] = item.split('.')
      return { columna, desc: direccion === 'desc' }
    })
    resultado = [...resultado].sort((a, b) => {
      for (const { columna, desc } of claves) {
        const izquierda = String(a[columna] ?? '')
        const derecha = String(b[columna] ?? '')
        if (izquierda === derecha) continue
        return (izquierda < derecha ? -1 : 1) * (desc ? -1 : 1)
      }
      return 0
    })
  }
  const limite = parametros.get('limit')
  if (limite) resultado = resultado.slice(0, Number(limite))
  return resultado
}

/**
 * Clave primaria de cada tabla, para resolver un upsert sin `onConflict` explícito (que es
 * como PostgREST resuelve el conflicto contra la PK). Por defecto, `id`.
 */
const CLAVES_PRIMARIAS: Record<string, string[]> = {
  client_memory: ['client_id'],
  campaign_recipients: ['campaign_id', 'client_id'],
}

export async function levantarSupabaseFalso(tablas: Tablas): Promise<SupabaseFalso> {
  const estado: SupabaseFalso = {
    url: '',
    tablas,
    rpc: [],
    respuestasRpc: {},
    peticiones: [],
    retardoLectura: 0,
    columnasDesconocidas: [],
    cerrar: async () => {},
  }

  const servidor: Server = createServer((peticion, respuesta) => {
    const trozos: Buffer[] = []
    peticion.on('data', (trozo: Buffer) => trozos.push(trozo))
    peticion.on('end', () => {
      void (async () => {
        const url = new URL(peticion.url ?? '/', 'http://interno')
        const partes = url.pathname.replace(/^\/rest\/v1\//, '').split('/')
        const tabla = partes[0]
        const cuerpo = trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : null
        const prefer = String(peticion.headers.prefer ?? '')
        const acepta = String(peticion.headers.accept ?? '')
        const devolver = (codigo: number, datos: unknown) => {
          respuesta.writeHead(codigo, { 'content-type': 'application/json' })
          respuesta.end(datos === undefined ? '' : JSON.stringify(datos))
        }
        const unaFila = (filas: Fila[]) => {
          if (!acepta.includes('vnd.pgrst.object')) return devolver(200, filas)
          if (filas.length === 1) return devolver(200, filas[0])
          return devolver(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: '', hint: null })
        }

        estado.peticiones.push({ metodo: peticion.method ?? '', tabla, filtros: url.search, cuerpo })

        if (tabla === 'rpc') {
          const nombre = partes[1]
          estado.rpc.push({ nombre, argumentos: cuerpo ?? {} })
          const manejador = estado.respuestasRpc[nombre]
          if (!manejador) return devolver(404, { code: '42883', message: `función ${nombre} no simulada` })
          try {
            return devolver(200, manejador(cuerpo ?? {}, estado.tablas) ?? null)
          } catch (error) {
            const fallo = error as { code?: string; message?: string }
            return devolver(400, { code: fallo.code ?? 'P0001', message: fallo.message ?? 'error', details: '', hint: null })
          }
        }

        const filas = estado.tablas[tabla] ?? (estado.tablas[tabla] = [])

        if (peticion.method === 'GET' || peticion.method === 'HEAD') {
          // El retardo va SOLO en la lectura: así dos ejecuciones leen antes de que
          // cualquiera escriba, que es el entrelazado que destapa un "leo y luego escribo".
          if (estado.retardoLectura) await espera(estado.retardoLectura)
          const encontradas = filtrar(filas, url.searchParams)
          // `select(..., { count: 'exact' })` lee el total de la cabecera content-range.
          if (/count=(exact|planned|estimated)/.test(prefer)) {
            respuesta.writeHead(200, {
              'content-type': 'application/json',
              'content-range': `0-${Math.max(encontradas.length - 1, 0)}/${encontradas.length}`,
            })
            return respuesta.end(peticion.method === 'HEAD' ? '' : JSON.stringify(encontradas))
          }
          return unaFila(encontradas)
        }

        // A partir de acá no hay ningún `await`: la mutación evalúa el filtro y escribe sin
        // que se intercale otra petición, igual que un UPDATE condicional en PostgreSQL.
        const desconocida = estado.columnasDesconocidas.find((columna) => cuerpo && Object.prototype.hasOwnProperty.call(cuerpo, columna))
        if (desconocida && peticion.method !== 'GET') {
          return devolver(400, {
            code: 'PGRST204',
            message: `Could not find the '${desconocida}' column of '${tabla}' in the schema cache`,
            details: null,
            hint: null,
          })
        }

        if (peticion.method === 'PATCH') {
          const afectadas = filtrar(filas, url.searchParams)
          for (const fila of afectadas) Object.assign(fila, cuerpo)
          return prefer.includes('return=representation') ? unaFila(afectadas) : devolver(204, undefined)
        }

        if (peticion.method === 'POST') {
          const entrantes: Fila[] = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
          const conflicto = url.searchParams.get('on_conflict')?.split(',') ?? CLAVES_PRIMARIAS[tabla] ?? ['id']
          const guardadas: Fila[] = []
          for (const entrante of entrantes) {
            const existente = conflicto.length && prefer.includes('resolution=merge-duplicates')
              ? filas.find((fila) => conflicto.every((columna) => mismoValor(fila[columna], entrante[columna])))
              : undefined
            if (existente) {
              Object.assign(existente, entrante)
              guardadas.push(existente)
            } else {
              const nueva = { id: `fila-${tabla}-${filas.length + 1}`, created_at: new Date().toISOString(), ...entrante }
              filas.push(nueva)
              guardadas.push(nueva)
            }
          }
          return prefer.includes('return=representation') ? unaFila(guardadas) : devolver(201, undefined)
        }

        if (peticion.method === 'DELETE') {
          const afectadas = filtrar(filas, url.searchParams)
          estado.tablas[tabla] = filas.filter((fila) => !afectadas.includes(fila))
          return prefer.includes('return=representation') ? unaFila(afectadas) : devolver(204, undefined)
        }

        return devolver(405, { message: `método ${peticion.method} no simulado` })
      })()
    })
  })

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  const puerto = (servidor.address() as AddressInfo).port
  estado.url = `http://127.0.0.1:${puerto}`
  estado.cerrar = () => new Promise<void>((listo) => servidor.close(() => listo()))
  return estado
}

/**
 * Apunta la app al doble. Se comprueba que la URL sea local: una prueba jamás debe poder
 * escribir en el Supabase real.
 */
export function usarSupabaseFalso(falso: SupabaseFalso, secreto = 'secreto-de-prueba') {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(falso.url)) throw new Error('El doble tiene que ser local')
  process.env.NEXT_PUBLIC_SUPABASE_URL = falso.url
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba'
  process.env.N8N_WEBHOOK_SECRET = secreto
  return secreto
}

/** Petición como la que manda n8n a `/api/agent/*`. */
export function peticionAgente(url: string, cuerpo: unknown, metodo = 'POST', secreto = 'secreto-de-prueba') {
  return new Request(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-agen-secret': secreto },
    body: JSON.stringify(cuerpo),
  })
}
