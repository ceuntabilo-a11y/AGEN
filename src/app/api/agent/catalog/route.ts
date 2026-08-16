import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { cargarCatalogo } from '@/lib/agent-context'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Catálogo del negocio para el agente. **Ruta heredada**: el workflow ya no la llama —lo suyo
 * viaja dentro de `/api/agent/context`—, pero se conserva por compatibilidad con despliegues
 * a medias y con integraciones antiguas.
 *
 * Delega en `cargarCatalogo`, la misma función que usa el contexto único. Antes eran dos copias
 * de las mismas cuatro consultas, y al añadirle a una el precio ya formateado la otra se quedó
 * atrás: dos rutas que prometen lo mismo tienen que salir del mismo sitio o se separan solas.
 */
export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { businessId } = await request.json() as { businessId?: string }
  if (!businessId) return NextResponse.json({ error: 'businessId es obligatorio' }, { status: 400 })

  const catalogo = await cargarCatalogo(createAdminClient(), businessId)
  if ('error' in catalogo) {
    if (catalogo.error === 'inexistente') return NextResponse.json({ error: 'Negocio inexistente o inactivo' }, { status: 404 })
    return NextResponse.json({ error: 'No se pudo cargar el catálogo' }, { status: 500 })
  }
  return NextResponse.json(catalogo)
}
