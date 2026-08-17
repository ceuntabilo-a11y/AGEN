import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Compatibilidad de esquema para la capa de plataforma (CLAUDE.md §5.7).
 *
 * La app se despliega antes que la migración —son dos pasos manuales distintos— y entre uno y
 * otro hay una ventana en la que las columnas nuevas todavía no existen. Pedirlas ahí no
 * devuelve un campo vacío: PostgREST tumba la consulta entera con `42703`, así que el panel de
 * negocios se quedaba sin ni un negocio y el resumen sin ni un número.
 *
 * La regla es la misma que ya se usaba para `maps_url`: se intenta con lo nuevo y, si la base
 * todavía no lo tiene, se repite con lo viejo y se rellenan los campos que faltan con lo que
 * significaban antes — ningún negocio era demo y ninguno vencía.
 */

/** Lo que añade `20260817000001_platform_lifecycle.sql` a `businesses`. */
export const COLUMNAS_NUEVAS = 'logo_url,is_demo,starts_on,expires_on,converted_at'

/** Los valores que tenían esos campos antes de existir. */
export type CamposDeVigencia = {
  logo_url: string | null
  is_demo: boolean
  starts_on: string | null
  expires_on: string | null
  converted_at: string | null
}

export function vigenciaPorDefecto(fila: { created_at?: unknown }): CamposDeVigencia {
  return {
    logo_url: null,
    is_demo: false,
    starts_on: fila.created_at ? String(fila.created_at).slice(0, 10) : null,
    expires_on: null,
    converted_at: null,
  }
}

/** PostgREST puede devolver un error tipado en `data`; solo interesan las filas reales. */
const filas = (valor: unknown): Array<Record<string, unknown>> =>
  Array.isArray(valor) ? (valor as Array<Record<string, unknown>>) : []

/** Lo único que se mira de la respuesta de PostgREST: los datos y el código de error. */
type RespuestaCruda = { data: unknown; error: { code?: string | null } | null }

/** `42703` = la columna no existe. Es el único error que justifica reintentar sin ella. */
export const faltaLaColumna = (error: { code?: string | null } | null | undefined) => error?.code === '42703'

/**
 * Consulta `businesses` con las columnas nuevas y, si la migración no está aplicada, repite sin
 * ellas rellenando los valores por defecto.
 *
 * `construir` recibe la lista de columnas para que quien llama decida el resto de la consulta
 * (orden, filtros, relaciones) una sola vez.
 */
export async function negociosConVigencia<T extends { created_at?: string | null }>(
  construir: (columnas: string) => PromiseLike<RespuestaCruda>,
  base: string,
): Promise<{ data: Array<T & CamposDeVigencia>; migrada: boolean; error: { code?: string | null } | null }> {
  const conNuevas = await construir(`${base},${COLUMNAS_NUEVAS}`)
  if (!conNuevas.error) {
    return { data: filas(conNuevas.data) as Array<T & CamposDeVigencia>, migrada: true, error: null }
  }
  if (!faltaLaColumna(conNuevas.error)) return { data: [], migrada: true, error: conNuevas.error }

  const sinNuevas = await construir(base)
  if (sinNuevas.error) return { data: [], migrada: false, error: sinNuevas.error }
  return {
    data: filas(sinNuevas.data).map((fila) => ({ ...(fila as T), ...vigenciaPorDefecto(fila) })),
    migrada: false,
    error: null,
  }
}

/**
 * Inserta un negocio quitando los campos nuevos si la base todavía no los tiene.
 *
 * Sin esto, crear un negocio en la ventana entre el despliegue y la migración fallaba entero.
 */
export async function insertarNegocio(
  db: SupabaseClient,
  fila: Record<string, unknown>,
): Promise<{ data: { id: string; [clave: string]: unknown } | null; error: { code?: string | null; message?: string } | null }> {
  const intento = await db.from('businesses').insert(fila).select().single()
  if (!intento.error || !faltaLaColumna(intento.error)) return intento

  const basico = { ...fila }
  for (const columna of COLUMNAS_NUEVAS.split(',')) delete basico[columna]
  return db.from('businesses').insert(basico).select().single()
}

/** Igual que `insertarNegocio`, para el PATCH de edición. */
export async function actualizarNegocio(
  db: SupabaseClient,
  id: string,
  cambios: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: { code?: string | null; message?: string } | null }> {
  const intento = await db.from('businesses').update(cambios).eq('id', id).select().single()
  if (!intento.error || !faltaLaColumna(intento.error)) return intento

  const basico = { ...cambios }
  for (const columna of COLUMNAS_NUEVAS.split(',')) delete basico[columna]
  if (Object.keys(basico).length === 0) {
    return { data: null, error: { code: '42703', message: 'Esos cambios necesitan la migración de plataforma' } }
  }
  return db.from('businesses').update(basico).eq('id', id).select().single()
}
