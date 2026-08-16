import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { cargarContexto } from '@/lib/agent-context'
import { respuestaRapida } from '@/lib/agent-fast-path'
import { normalizePhone } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Todo el contexto de un turno del agente, en UNA llamada.
 *
 * Sustituye a las dos que hacía el workflow (`/api/agent/memory` y `/api/agent/catalog`), que
 * además corrían en secuencia y por dentro encadenaban sus propias consultas. Medido contra
 * producción, entre las dos se iban 1,5–2,5 s de cada turno sin que ninguna dependiera de la
 * otra.
 *
 * Devuelve exactamente los mismos campos que devolvían las dos juntas: el prompt los lee por
 * nombre y no cambia. Las dos rutas anteriores siguen existiendo —`/api/agent/memory` además
 * tiene el `PUT` con el que el agente guarda lo que aprendió— así que un despliegue a medias
 * no rompe nada.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json() as { businessId?: string; phone?: string; message?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone) {
    return NextResponse.json({ error: 'businessId y phone son obligatorios' }, { status: 400 })
  }

  // El mensaje se usa SOLO para decidir si el último aviso automático viene al caso: un «Hola»
  // no contesta a un seguimiento pendiente. Ver `pareceRespuestaAlAviso`.
  const contexto = await cargarContexto(createAdminClient(), {
    businessId: body.businessId,
    phone,
    message: typeof body.message === 'string' ? body.message.slice(0, 500) : null,
  })
  if ('error' in contexto) {
    if (contexto.error === 'inexistente') return NextResponse.json({ error: 'Negocio inexistente o inactivo' }, { status: 404 })
    if (contexto.error === 'agenda') return NextResponse.json({ error: 'No se pudo consultar la agenda del equipo' }, { status: 500 })
    return NextResponse.json({ error: 'No se pudo cargar el catálogo' }, { status: 500 })
  }
  /*
   * Camino rápido (ver `@/lib/agent-fast-path`): si el turno es un saludo, un agradecimiento o
   * una despedida, la respuesta ya está decidida y el workflow se salta al modelo entero. Va
   * ACÁ, y no en n8n, porque es una decisión determinista que se puede probar.
   *
   * Es un campo más: un despliegue en el que n8n todavía no conozca `respuestaRapida` sigue
   * llamando al agente como siempre.
   */
  const rapida = respuestaRapida(body.message, {
    actorType: contexto.actorType,
    pendingNotice: contexto.pendingNotice,
    businessName: (contexto.business as { name?: string } | undefined)?.name ?? null,
  })

  return NextResponse.json({ ...contexto, respuestaRapida: rapida?.texto ?? null })
}
