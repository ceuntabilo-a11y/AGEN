import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { cargarContexto } from '@/lib/agent-context'
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

  const body = await request.json() as { businessId?: string; phone?: string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone) {
    return NextResponse.json({ error: 'businessId y phone son obligatorios' }, { status: 400 })
  }

  const contexto = await cargarContexto(createAdminClient(), { businessId: body.businessId, phone })
  if ('error' in contexto) {
    if (contexto.error === 'inexistente') return NextResponse.json({ error: 'Negocio inexistente o inactivo' }, { status: 404 })
    if (contexto.error === 'agenda') return NextResponse.json({ error: 'No se pudo consultar la agenda del equipo' }, { status: 500 })
    return NextResponse.json({ error: 'No se pudo cargar el catálogo' }, { status: 500 })
  }
  return NextResponse.json(contexto)
}
