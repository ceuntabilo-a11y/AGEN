/**
 * Claves de plataforma: qué se puede guardar, qué se devuelve al navegador y cómo se
 * interpreta lo que llega del formulario.
 *
 * Está separado de la ruta porque acá vive la decisión que rompía el guardado: **una clave
 * vacía no es `null`**. `platform_settings.value` es `jsonb not null`, así que mandar `null`
 * —que es lo que hacía el formulario con cada campo que el administrador dejaba en blanco—
 * violaba la restricción y tumbaba el PATCH entero. Rellenar solo la clave de DashScope y
 * dejar Evolution y Resend vacíos bastaba para que no se guardara nada.
 *
 * Reglas, ahora explícitas:
 *   · campo ausente o `null`  → no se toca (el administrador no lo editó);
 *   · campo con texto         → se guarda ese texto;
 *   · campo con cadena vacía  → se BORRA la fila, que es lo que de verdad significa "quitar".
 *     Nunca se escribe `null` en la columna.
 */

/** Todo lo que la plataforma acepta guardar. Nada fuera de esta lista entra. */
export const CLAVES_PLATAFORMA = [
  'openai_fallback_key',
  'dashscope_fallback_key',
  'dashscope_fallback_endpoint',
  'evolution_api_url',
  'evolution_api_key',
  'resend_api_key',
  'resend_from',
  'n8n_api_url',
  'referral_headline',
  'referral_percent',
  'referral_terms',
] as const

export type ClavePlataforma = (typeof CLAVES_PLATAFORMA)[number]

/**
 * Las que son credenciales. Su valor **nunca** vuelve al navegador: se devuelve solo si están
 * configuradas y sus últimos caracteres, lo justo para reconocerlas sin poder reutilizarlas.
 */
export const CLAVES_SECRETAS: readonly ClavePlataforma[] = [
  'openai_fallback_key',
  'dashscope_fallback_key',
  'evolution_api_key',
  'resend_api_key',
]

export const esSecreta = (clave: string): boolean => CLAVES_SECRETAS.includes(clave as ClavePlataforma)

/** `sk-proj-abcdefgh1234` → `••••1234`. Sin longitud real y sin prefijo reconocible. */
export function enmascarar(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return null
  const limpio = valor.trim()
  return `••••${limpio.slice(-4)}`
}

export interface EntradasNormalizadas {
  /** Claves con valor nuevo, listas para escribir. */
  guardar: Array<{ key: ClavePlataforma; value: string }>
  /** Claves que el administrador pidió quitar: se borra la fila, no se escribe null. */
  borrar: ClavePlataforma[]
  /** Claves del cuerpo que no existen; se informan para no fallar en silencio. */
  desconocidas: string[]
}

const LARGO_MAXIMO = 2000

/**
 * Traduce el cuerpo del PATCH a operaciones concretas.
 *
 * Acepta números (por `referral_percent`) convirtiéndolos a texto: la columna es `jsonb` y el
 * resto del código lee estos valores como cadenas.
 */
export function normalizarEntradas(cuerpo: unknown): EntradasNormalizadas {
  const salida: EntradasNormalizadas = { guardar: [], borrar: [], desconocidas: [] }
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return salida

  for (const [clave, valor] of Object.entries(cuerpo as Record<string, unknown>)) {
    if (!CLAVES_PLATAFORMA.includes(clave as ClavePlataforma)) {
      salida.desconocidas.push(clave)
      continue
    }
    // Ausente o null: el administrador no editó ese campo. No se toca.
    if (valor === null || valor === undefined) continue

    const texto = typeof valor === 'number' ? String(valor) : typeof valor === 'string' ? valor : ''
    const limpio = texto.trim().slice(0, LARGO_MAXIMO)

    if (!limpio) salida.borrar.push(clave as ClavePlataforma)
    else salida.guardar.push({ key: clave as ClavePlataforma, value: limpio })
  }

  return salida
}

/** ¿Hay algo que hacer? Un cuerpo que solo trae `null` no es un error: es "no cambié nada". */
export const hayCambios = (entradas: EntradasNormalizadas): boolean =>
  entradas.guardar.length > 0 || entradas.borrar.length > 0

/**
 * Lo que se le devuelve al navegador: las secretas solo dicen si están puestas; el resto van
 * en claro porque no son credenciales (un endpoint, un remitente, el texto de referidos).
 */
export function vistaSegura(filas: Array<{ key: string; value: unknown }>): Record<string, unknown> {
  const porClave = new Map(filas.map((fila) => [fila.key, fila.value]))
  const salida: Record<string, unknown> = {}
  for (const clave of CLAVES_PLATAFORMA) {
    const valor = porClave.get(clave) ?? null
    if (esSecreta(clave)) {
      salida[clave] = { configurada: typeof valor === 'string' && valor.trim().length > 0, pista: enmascarar(valor) }
    } else {
      salida[clave] = typeof valor === 'string' ? valor : null
    }
  }
  return salida
}

/** Lo mínimo que hace falta para leer una clave: así esto no depende del cliente de Supabase. */
type LectorDeClaves = {
  from: (tabla: string) => {
    select: (columnas: string) => {
      eq: (clave: string, valor: string) => { maybeSingle: () => Promise<{ data: { value?: unknown } | null }> }
    }
  }
}

/**
 * La URL de n8n para el monitor de salud.
 *
 * Sale de `platform_settings` y solo cae al entorno como respaldo. Ese era el fallo de fondo del
 * monitor: miraba únicamente `process.env.N8N_API_URL`, que existe en el equipo de quien
 * desarrolla pero no en el servicio desplegado, así que n8n aparecía «sin configurar» estando
 * perfectamente vivo. Guardada en la base se cambia desde /plataforma/claves sin desplegar.
 *
 * Se normaliza venga de donde venga: sin la ruta del webhook y sin barra final.
 */
export async function urlDeN8n(db: { from: (tabla: string) => any }): Promise<string | null> {
  let guardada: string | null = null
  try {
    const { data } = await db.from('platform_settings').select('value').eq('key', 'n8n_api_url').maybeSingle()
    if (typeof data?.value === 'string') guardada = data.value
  } catch { /* sin fila todavía: se usa el entorno */ }

  const base = (guardada || process.env.N8N_API_URL || process.env.N8N_WEBHOOK_URL || '')
    .trim()
    .replace(/\/webhook.*$/, '')
    .replace(/\/+$/, '')
  return base || null
}
