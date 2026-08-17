import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from '@/lib/phone'

/**
 * La clave con la que se guarda y se busca un apartado, SIEMPRE igual.
 *
 * Fallo real, encontrado probando el router en producción (ejecución 10685): `/api/agent/slots`
 * guardaba el apartado con el teléfono tal como lo manda n8n (`+56911112222`) y el turno lo
 * buscaba ya normalizado (`56911112222`). Nunca coincidían, así que el cliente elegía un
 * horario que se le había ofrecido y el sistema no encontraba ningún apartado vivo: la reserva
 * no llegaba a hacerse.
 *
 * Un teléfono no puede tener dos formas en la misma columna. Esta función es la única.
 */
export function claveDeContacto(valor: unknown): string | null {
  const telefono = normalizePhone(valor)
  if (telefono) return telefono
  const texto = String(valor ?? '').trim()
  return texto || null
}

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
  const contacto = claveDeContacto(datos.contactKey)
  if (!datos.clientId && !contacto) return 0

  // Se sueltan por AMBAS claves. Un mismo contacto empieza sin clientId (todavía no es
  // cliente) y lo gana al registrarse en mitad de la conversación: si solo se mirara una de
  // las dos, los apartados de la otra quedaban bloqueando cupos hasta vencer.
  // También la forma con `+`: los apartados creados antes de normalizar la clave se guardaron
  // así, y si no se soltaran seguirían bloqueando cupos hasta vencer.
  const filtros = [
    ...(datos.clientId ? [`client_id.eq.${datos.clientId}`] : []),
    ...(contacto ? [`contact_key.eq.${contacto}`, `contact_key.eq.+${contacto}`] : []),
  ]

  const { data } = await db.from('appointment_holds')
    .delete()
    .eq('business_id', datos.businessId)
    .or(filtros.join(','))
    .select('id')
  return (data ?? []).length
}
