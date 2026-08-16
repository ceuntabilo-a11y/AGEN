/**
 * Por qué no salió lo que el agente pidió, en una palabra que el modelo no tiene que interpretar.
 *
 * El problema que resuelve: las herramientas devolvían `{status, body}` y nada más, así que ante
 * un 500 o una lista vacía el modelo IMPROVISABA la explicación —«ese horario ya no está
 * disponible», «creo que hubo un problema»— y a veces la improvisación era falsa. Un código
 * cerrado convierte esa decisión en una tabla del prompt: a cada `motivo` le corresponde una
 * frase, y no hay margen para inventar.
 *
 * Cada valor significa una cosa distinta para el cliente, no para el programador:
 * - `SIN_CUPOS`       el negocio abre ese día, pero no queda ninguna hora libre.
 * - `NEGOCIO_CERRADO` ese día no se atiende. Ofrecer otro día, no otra hora.
 * - `CUPO_OCUPADO`    alguien tomó ese cupo, o el apartado venció. Hay que volver a buscar.
 * - `NO_EXISTE`       el servicio, el profesional o la reserva no existen.
 * - `DATO_INVALIDO`   faltó un dato o vino mal formado. Es culpa de la llamada, no del cliente.
 * - `NO_AUTORIZADO`   quien escribe no puede hacer eso (por ejemplo, el equipo reservando).
 * - `ERROR_TECNICO`   se cayó algo. Nunca se le echa la culpa al cliente ni se inventa un motivo.
 */
export type MotivoAgente =
  | 'SIN_CUPOS' | 'NEGOCIO_CERRADO' | 'CUPO_OCUPADO'
  | 'NO_EXISTE' | 'DATO_INVALIDO' | 'NO_AUTORIZADO' | 'ERROR_TECNICO'

/** Códigos de PostgreSQL que ya usan las funciones `*_safe_appointment` (CLAUDE.md §1). */
const POR_ERRCODE: Record<string, MotivoAgente> = {
  '23P01': 'CUPO_OCUPADO',
  '23505': 'CUPO_OCUPADO',
  '42501': 'NO_AUTORIZADO',
  P0002: 'NO_EXISTE',
  P0001: 'NEGOCIO_CERRADO',
  '22007': 'DATO_INVALIDO',
  '22023': 'DATO_INVALIDO',
}

/**
 * Traduce un error de Supabase al motivo que verá el modelo.
 *
 * `P0001` es la regla de negocio genérica y en la práctica casi siempre es el negocio cerrado
 * (`assert_business_open`), pero no siempre: si el mensaje no habla de cierre, se degrada a
 * error técnico en vez de afirmar algo que no consta.
 */
export function motivoDeError(error: { code?: string | null; message?: string | null } | null | undefined): MotivoAgente {
  if (!error) return 'ERROR_TECNICO'
  const codigo = String(error.code ?? '')
  const motivo = POR_ERRCODE[codigo]
  if (!motivo) return 'ERROR_TECNICO'
  if (motivo !== 'NEGOCIO_CERRADO') return motivo
  return /cerrad|no atiende|fuera del horario/i.test(String(error.message ?? '')) ? 'NEGOCIO_CERRADO' : 'ERROR_TECNICO'
}
