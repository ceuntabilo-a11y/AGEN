import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Apartados temporales que crea el agente al ofrecer horarios.
 *
 * Cada búsqueda aparta hasta 3 cupos por 15 minutos. Si una consulta repetida (el cliente
 * pregunta otra vez, el modelo reintenta la tool, llega un mensaje duplicado) dejara los
 * apartados anteriores vivos, se irían acumulando cupos bloqueados para todos los demás.
 *
 * Por eso, antes de apartar de nuevo se sueltan los apartados que ya tenía ESE contacto.
 */
export async function liberarHoldsPrevios(
  db: SupabaseClient,
  datos: { businessId: string; clientId?: string | null; contactKey?: string | null },
) {
  const contacto = datos.contactKey?.trim() || null
  if (!datos.clientId && !contacto) return 0

  // Se sueltan por AMBAS claves. Un mismo contacto empieza sin clientId (todavía no es
  // cliente) y lo gana al registrarse en mitad de la conversación: si solo se mirara una de
  // las dos, los apartados de la otra quedaban bloqueando cupos hasta vencer.
  const filtros = [
    ...(datos.clientId ? [`client_id.eq.${datos.clientId}`] : []),
    ...(contacto ? [`contact_key.eq.${contacto}`] : []),
  ]

  const { data } = await db.from('appointment_holds')
    .delete()
    .eq('business_id', datos.businessId)
    .or(filtros.join(','))
    .select('id')
  return (data ?? []).length
}
