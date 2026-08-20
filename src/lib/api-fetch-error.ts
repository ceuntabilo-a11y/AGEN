/**
 * Traduce una respuesta HTTP fallida (o su ausencia, sin red) a un mensaje que de verdad ayuda.
 *
 * Antes, cada pantalla del panel mostraba "Conecta Supabase para..." ante CUALQUIER fallo —una
 * sesión vencida, un permiso insuficiente, un error real del servidor o un corte de red
 * mostraban exactamente el mismo texto. Eso es casi siempre falso (Supabase rara vez es el
 * problema) y esconde la causa real justo cuando más hace falta verla. Esta función separa los
 * casos: solo el fallo de red de verdad menciona la conexión.
 */
export function mensajeDeFallo(status: number | null, contexto: string): string {
  if (status === null) return `No se pudo conectar con el servidor para ${contexto}. Revisa tu conexión a internet e intenta de nuevo.`
  if (status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.'
  if (status === 403) return `No tienes permiso para ${contexto}.`
  if (status === 429) return 'Demasiadas solicitudes seguidas. Espera un momento e intenta de nuevo.'
  if (status >= 500) return 'El servidor tuvo un error al cargar esto. Intenta de nuevo en un momento; si sigue pasando, avísale al equipo de Agen.'
  return 'No se pudo cargar. Intenta de nuevo.'
}
