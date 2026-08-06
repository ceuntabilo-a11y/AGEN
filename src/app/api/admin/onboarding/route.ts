import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

/** Primeros pasos: cada punto se marca solo, mirando la base, nunca a mano. */
export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const [business, services, professionals, availability, clients, appointments] = await Promise.all([
      db.from('businesses').select('name,phone,logo_url,agent_settings,settings').eq('id', businessId).single(),
      db.from('services').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('active', true),
      db.from('professionals').select('id').eq('business_id', businessId).eq('active', true),
      db.from('professional_availability').select('professional_id'),
      db.from('clients').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
      db.from('appointments').select('id', { count: 'exact', head: true }).eq('business_id', businessId),
    ])
    const failure = business.error || services.error || professionals.error || availability.error || clients.error || appointments.error
    if (failure) throw failure

    const activeIds = new Set((professionals.data ?? []).map((professional) => professional.id))
    const withSchedule = new Set((availability.data ?? []).map((row) => row.professional_id).filter((id) => activeIds.has(id)))
    const agent = (business.data?.agent_settings ?? {}) as { enabled?: boolean }

    // El proveedor de WhatsApp vive en la capa de plataforma: si esa migración no está, el paso queda pendiente sin romper nada.
    let whatsapp = false
    const channel = await db.from('businesses').select('whatsapp_provider').eq('id', businessId).maybeSingle()
    if (!channel.error) whatsapp = Boolean((channel.data as { whatsapp_provider?: string | null } | null)?.whatsapp_provider)

    const steps = [
      { key: 'services', title: 'Cargar tus servicios', detail: 'Duración, precio y costo de cada servicio que ofreces.', href: '/admin/servicios', done: (services.count ?? 0) > 0 },
      { key: 'professionals', title: 'Agregar a tu equipo', detail: 'Cada profesional con su especialidad y sus servicios.', href: '/admin/equipo', done: activeIds.size > 0 },
      { key: 'schedule', title: 'Definir horarios de atención', detail: 'Sin horario cargado no se generan cupos y nadie puede reservar.', href: '/admin/equipo', done: activeIds.size > 0 && withSchedule.size === activeIds.size },
      { key: 'clients', title: 'Tener clientes cargados', detail: 'Créalos a mano o impórtalos desde tu planilla.', href: '/admin/clientes', done: (clients.count ?? 0) > 0 },
      { key: 'appointments', title: 'Registrar la primera reserva', detail: 'Desde la agenda, la ficha del cliente o el propio agente.', href: '/admin/agenda', done: (appointments.count ?? 0) > 0 },
      { key: 'identity', title: 'Subir tu logo', detail: 'Se usa en el portal del cliente y en los correos.', href: '/admin/configuracion', done: Boolean(business.data?.logo_url) },
      { key: 'whatsapp', title: 'Conectar WhatsApp', detail: 'Para que el agente pueda atender y confirmar por mensaje.', href: '/admin/integraciones', done: whatsapp },
      { key: 'agent', title: 'Encender el agente', detail: 'Revisa su personalidad y actívalo cuando estés listo.', href: '/admin/agente', done: Boolean(agent.enabled) },
    ]
    return NextResponse.json({ steps, done: steps.filter((step) => step.done).length, total: steps.length })
  } catch (error) { return apiError(error) }
}
