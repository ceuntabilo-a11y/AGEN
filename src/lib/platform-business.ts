/**
 * Reglas del ciclo comercial de un negocio: cómo se llama en la URL, cuánto dura y en qué
 * estado está hoy.
 *
 * Vive fuera de las rutas porque son decisiones de negocio con respuesta exacta —y por tanto
 * comprobables— y porque las usan tanto crear como editar como el panel de resumen. Que el
 * estado se calcule en UN sitio es lo que evita que la lista diga "activo" y el detalle
 * "vencido" sobre el mismo negocio.
 */

/** Duraciones ofrecidas al crear o editar. `null` = sin vencimiento (cliente pagado). */
export const DURACIONES = [1, 3, 7, 15, 30, 60] as const

export type EstadoNegocio = 'ACTIVO' | 'DEMO' | 'VENCIDO' | 'SUSPENDIDO' | 'INACTIVO'

/**
 * El identificador del negocio dentro de una URL.
 *
 * El administrador no tiene por qué saber qué es un «slug», así que se genera desde el nombre y
 * solo se muestra explicado. Quita acentos, pasa a minúsculas y deja letras, números y guiones:
 * «Estética Bella Vida» → `estetica-bella-vida`.
 */
export function slugDesdeNombre(nombre: string): string {
  return String(nombre ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** El formato que acepta la base. Mismo criterio en el navegador y en el servidor. */
export const SLUG_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function slugValido(slug: string): boolean {
  return SLUG_VALIDO.test(String(slug ?? '')) && slug.length >= 2 && slug.length <= 60
}

/**
 * La fecha de vencimiento a partir de la de inicio y los días de duración.
 *
 * El último día es inclusive: una demo de 7 días que empieza el 1 vence el 7, no el 8, porque
 * eso es lo que entiende quien la vende. `null` días = sin vencimiento.
 */
export function vencimientoDesdeDuracion(inicio: string, dias: number | null): string | null {
  if (dias === null || !Number.isFinite(dias) || dias <= 0) return null
  const base = new Date(`${inicio}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return null
  base.setUTCDate(base.getUTCDate() + Math.floor(dias) - 1)
  return base.toISOString().slice(0, 10)
}

/** Días que faltan para vencer, contando hoy. Negativo = ya venció. `null` = no vence. */
export function diasRestantes(expiresOn: string | null | undefined, hoy: string): number | null {
  if (!expiresOn) return null
  const fin = Date.parse(`${expiresOn}T00:00:00Z`)
  const ahora = Date.parse(`${hoy}T00:00:00Z`)
  if (Number.isNaN(fin) || Number.isNaN(ahora)) return null
  return Math.round((fin - ahora) / 86400000)
}

/**
 * En qué estado está el negocio HOY, mirando en el mismo orden en que importa:
 * suspendido gana sobre todo, después apagado, después vencido, y solo entonces demo o activo.
 *
 * Se calcula, no se guarda: una columna de estado se queda vieja sola en cuanto pasa la
 * medianoche, y entonces el panel muestra como vigente algo que venció ayer.
 */
export function estadoDeNegocio(
  negocio: { active?: boolean | null; suspended_at?: string | null; is_demo?: boolean | null; expires_on?: string | null },
  hoy: string,
): EstadoNegocio {
  if (negocio.suspended_at) return 'SUSPENDIDO'
  if (negocio.active === false) return 'INACTIVO'
  const restantes = diasRestantes(negocio.expires_on, hoy)
  if (restantes !== null && restantes < 0) return 'VENCIDO'
  return negocio.is_demo ? 'DEMO' : 'ACTIVO'
}

export const ETIQUETA_ESTADO: Record<EstadoNegocio, string> = {
  ACTIVO: 'Activo',
  DEMO: 'Demo',
  VENCIDO: 'Vencido',
  SUSPENDIDO: 'Suspendido',
  INACTIVO: 'Inactivo',
}

/** Cuántos días antes de vencer se considera «próximo a vencer». */
export const AVISO_VENCIMIENTO_DIAS = 7
