#!/usr/bin/env node
/**
 * Consultas de SOLO LECTURA contra la base de AGEN, sin abrir el panel de Supabase.
 *
 * Existe para poder comprobar de verdad lo que pasó —¿la reserva quedó en la base?, ¿con qué
 * profesional?, ¿en qué zona horaria?— sin escribir `curl` con cabeceras y tuberías (la forma
 * que dispara el diálogo de aprobación) y sin arriesgar una mutación por descuido.
 *
 *   npm run db -- tablas                              tablas que expone PostgREST
 *   npm run db -- ver <tabla> [n]                     primeras filas
 *   npm run db -- buscar <tabla> <col=valor> [n]      filtro exacto por una columna
 *   npm run db -- columnas <tabla> <c1,c2,...> [n]    solo esas columnas
 *   npm run db -- contar <tabla> [col=valor]          cuántas filas
 *   npm run db -- negocios                            negocios activos, con id y zona horaria
 *
 * Por construcción no puede escribir: **solo emite peticiones GET**. No hay orden de insertar,
 * actualizar ni borrar, y el método está fijado en el código, no en un argumento. Las
 * credenciales salen de `.env.local` y nunca se imprimen.
 *
 * Aun así, la clave que usa es la de servicio y salta RLS: sirve para VER, no para tocar. Para
 * cualquier mutación se usan las funciones SQL seguras desde la aplicación (CLAUDE.md §5).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.join(RAIZ, '.env.local')
if (existsSync(ENV) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV)

const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!BASE || !CLAVE) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env.local.')
  process.exit(2)
}

/** Única puerta a la base, y siempre GET. */
async function leer(ruta, { conteo = false } = {}) {
  const respuesta = await fetch(`${BASE}/rest/v1/${ruta}`, {
    method: 'GET',
    headers: {
      apikey: CLAVE,
      authorization: `Bearer ${CLAVE}`,
      accept: 'application/json',
      ...(conteo ? { prefer: 'count=exact' } : {}),
    },
    signal: AbortSignal.timeout(30000),
  })
  const texto = await respuesta.text()
  if (!respuesta.ok) {
    console.error(`La base respondió ${respuesta.status}: ${texto.slice(0, 400)}`)
    process.exit(1)
  }
  return { filas: texto ? JSON.parse(texto) : [], rango: respuesta.headers.get('content-range') }
}

/** `columna=valor` → filtro de PostgREST, con el valor escapado. */
function filtro(expresion) {
  const corte = expresion.indexOf('=')
  if (corte < 1) { console.error(`Filtro inválido: ${expresion}. Usa columna=valor.`); process.exit(2) }
  const columna = expresion.slice(0, corte)
  const valor = expresion.slice(corte + 1)
  if (!/^[a-z_][a-z0-9_]*$/i.test(columna)) { console.error(`Columna inválida: ${columna}`); process.exit(2) }
  return `${columna}=eq.${encodeURIComponent(valor)}`
}

const tabla = (nombre) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(nombre)) { console.error(`Tabla inválida: ${nombre}`); process.exit(2) }
  return nombre
}

const imprimir = (filas) => console.log(JSON.stringify(filas, null, 1))

const [orden, ...resto] = process.argv.slice(2)

switch (orden) {
  case 'tablas': {
    const respuesta = await fetch(`${BASE}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: CLAVE, authorization: `Bearer ${CLAVE}`, accept: 'application/openapi+json' },
    })
    const esquema = await respuesta.json()
    console.log(Object.keys(esquema.definitions ?? esquema.paths ?? {}).join('\n'))
    break
  }

  case 'ver': {
    const { filas } = await leer(`${tabla(resto[0])}?limit=${Number(resto[1]) || 10}`)
    imprimir(filas)
    break
  }

  case 'buscar': {
    const { filas } = await leer(`${tabla(resto[0])}?${filtro(resto[1])}&limit=${Number(resto[2]) || 20}`)
    imprimir(filas)
    break
  }

  case 'columnas': {
    const columnas = String(resto[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean)
    if (!columnas.length) { console.error('Uso: columnas <tabla> <c1,c2,...> [n]'); process.exit(2) }
    const { filas } = await leer(`${tabla(resto[0])}?select=${columnas.join(',')}&limit=${Number(resto[2]) || 20}`)
    imprimir(filas)
    break
  }

  case 'contar': {
    const extra = resto[1] ? `&${filtro(resto[1])}` : ''
    const { rango } = await leer(`${tabla(resto[0])}?select=id&limit=1${extra}`, { conteo: true })
    console.log(rango ? rango.split('/')[1] : 'sin dato')
    break
  }

  case 'negocios': {
    const { filas } = await leer('businesses?select=id,name,active,timezone,phone&order=name&limit=50')
    for (const n of filas) {
      console.log(`${n.id}\t${n.active ? 'activo  ' : 'inactivo'}\t${n.timezone ?? '—'}\t${n.name}`)
    }
    break
  }

  default:
    console.log('Órdenes: tablas · ver · buscar · columnas · contar · negocios')
    console.log('Ejemplo: npm run db -- buscar appointments business_id=<uuid> 5')
    process.exitCode = orden ? 2 : 0
}
