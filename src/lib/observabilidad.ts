/**
 * Registro estructurado de eventos del servidor.
 *
 * Por qué existe: varios caminos del agente devuelven a propósito una respuesta suave cuando
 * algo falla —`/api/agent/media` responde `text:null`, `/api/agent/voice/reply` responde
 * `speak:false, sendText:true`— para que el cliente nunca se quede sin contestación. Está
 * bien de cara al cliente, pero hacia dentro dejaba el fallo invisible: si la clave de OpenAI
 * caducaba o DashScope empezaba a devolver 429, el agente seguía respondiendo en texto y nadie
 * se enteraba nunca. Esto es lo que hace que ese silencio quede registrado.
 *
 * Formato: una línea JSON por evento en stdout/stderr, que es lo que recogen los logs del
 * contenedor en EasyPanel. Sin dependencias y sin servicio externo.
 *
 * Regla no negociable: **nunca se registra un secreto**. Los valores se sanean antes de
 * salir (ver `sanear`), y las claves cuyo nombre suene a credencial se reemplazan por
 * `[oculto]` aunque quien llame se haya equivocado al pasarlas.
 */

export type NivelEvento = 'info' | 'aviso' | 'error'

/** Nombres de campo que jamás se imprimen, se llamen como se llamen dentro del objeto. */
const CLAVES_PROHIBIDAS = /(key|token|secret|password|clave|authorization|cookie|apikey)/i

/** Trozos que delatan un secreto aunque el nombre del campo parezca inocente. */
const VALORES_PROHIBIDOS = [/^sk-[A-Za-z0-9_-]{10,}/, /^gh[pousr]_[A-Za-z0-9]{10,}/, /^eyJ[A-Za-z0-9_-]{20,}/]

const LARGO_MAXIMO = 300

function saneaValor(valor: unknown): unknown {
  if (valor === null || valor === undefined) return valor
  if (valor instanceof Error) return `${valor.name}: ${valor.message}`.slice(0, LARGO_MAXIMO)
  if (typeof valor === 'string') {
    if (VALORES_PROHIBIDOS.some((patron) => patron.test(valor))) return '[oculto]'
    return valor.length > LARGO_MAXIMO ? `${valor.slice(0, LARGO_MAXIMO)}…` : valor
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor
  if (Array.isArray(valor)) return valor.slice(0, 20).map(saneaValor)
  if (typeof valor === 'object') return sanear(valor as Record<string, unknown>)
  return String(valor).slice(0, LARGO_MAXIMO)
}

/** Deja el objeto listo para imprimir: sin secretos, sin objetos enormes. */
export function sanear(datos: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(datos)) {
    salida[clave] = CLAVES_PROHIBIDAS.test(clave) ? '[oculto]' : saneaValor(valor)
  }
  return salida
}

/**
 * Escribe un evento.
 *
 * @param nivel   `error` va a stderr; el resto a stdout.
 * @param evento  Identificador estable y corto, en snake_case: `agent_media_sin_clave`.
 *                Es lo que se busca en los logs, así que no se cambia a la ligera.
 * @param datos   Contexto. `businessId` sí (identifica al tenant sin revelar nada del
 *                cliente); teléfonos, correos y claves NO.
 */
export function registrar(nivel: NivelEvento, evento: string, datos: Record<string, unknown> = {}): void {
  const linea = JSON.stringify({ ts: new Date().toISOString(), nivel, evento, ...sanear(datos) })
  if (nivel === 'error') console.error(linea)
  else console.log(linea)
}

export const registrarAviso = (evento: string, datos?: Record<string, unknown>) => registrar('aviso', evento, datos)
export const registrarError = (evento: string, datos?: Record<string, unknown>) => registrar('error', evento, datos)
