import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { validTimeZone } from '@/lib/timezone'
import { errorDeRecordatorios } from '@/lib/reminders'
import { esEnlaceDeResena } from '@/lib/agent-encuesta'
import { isRealClientPhone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    // El plan vive en la capa de plataforma: si esa migración todavía no se aplicó, la página igual funciona.
    const plan = await db.from('businesses').select('plan:membership_plans(name,price,max_professionals)').eq('id',businessId).maybeSingle()
    const planData = plan.error ? null : (Array.isArray((plan.data as any)?.plan) ? (plan.data as any).plan[0] : (plan.data as any)?.plan) ?? null
    const current = await db.from('businesses').select('id,name,slug,timezone,currency,phone,email,address,maps_url,logo_url,settings,agent_settings').eq('id',businessId).single()
    if (!current.error) return NextResponse.json({ business: current.data, plan: planData })
    const fallback = await db.from('businesses').select('id,name,slug,timezone,currency,phone,email,address,logo_url,settings,agent_settings').eq('id',businessId).single()
    if (fallback.error) throw fallback.error
    return NextResponse.json({ business: { ...fallback.data, maps_url: null }, plan: planData })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER','ADMIN'])
    const body = await request.json() as Record<string, unknown>
    if (body.timezone !== undefined && !validTimeZone(body.timezone)) return NextResponse.json({ error: 'Zona horaria inválida' }, { status: 400 })
    if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) return NextResponse.json({ error: 'Moneda inválida' }, { status: 400 })
    if (body.maps_url) {
      try {
        const url = new URL(String(body.maps_url))
        if (!['http:','https:'].includes(url.protocol)) throw new Error()
      } catch { return NextResponse.json({ error: 'El enlace de Google Maps no es válido' }, { status: 400 }) }
    }
    // El horario del negocio bloquea reservas: se valida antes de guardarlo.
    const hours = (body.settings as Record<string, unknown> | undefined)?.business_hours
    if (hours !== undefined) {
      if (!Array.isArray(hours) || hours.length > 7) return NextResponse.json({ error: 'Horario del negocio inválido' }, { status: 400 })
      for (const entry of hours as Array<Record<string, unknown>>) {
        const day = Number(entry?.day)
        if (!Number.isInteger(day) || day < 1 || day > 7) return NextResponse.json({ error: 'Horario del negocio inválido: día fuera de rango' }, { status: 400 })
        if (entry?.enabled === false) continue
        const start = String(entry?.start ?? ''), end = String(entry?.end ?? '')
        if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return NextResponse.json({ error: 'Horario del negocio inválido: usa horas con formato HH:MM' }, { status: 400 })
        if (start >= end) return NextResponse.json({ error: 'Horario del negocio inválido: la hora de cierre debe ser posterior a la de apertura' }, { status: 400 })
      }
      if ((hours as Array<Record<string, unknown>>).every((entry) => entry?.enabled === false)) {
        return NextResponse.json({ error: 'Deja al menos un día abierto: con todos cerrados nadie puede reservar' }, { status: 400 })
      }
    }

    // Los recordatorios los programa una función SQL a partir de esta lista: si entra mal,
    // el negocio se queda sin avisos y nadie se entera hasta que un cliente no llega.
    const errorRecordatorios = errorDeRecordatorios((body.settings as Record<string, unknown> | undefined)?.reminders)
    if (errorRecordatorios) return NextResponse.json({ error: errorRecordatorios }, { status: 400 })

    /*
     * El enlace de reseña se le manda tal cual a los clientes que ponen 9 o 10: si estuviera
     * mal, cada promotor recibiría una dirección rota. Se valida al guardar, no al enviar.
     */
    /*
     * El número al que se transfiere una conversación. Si estuviera mal escrito, el aviso no
     * llegaría a nadie y el cliente quedaría esperando a una persona que nunca se enteró.
     */
    const telefonoTransferencia = (body.agent_settings as Record<string, unknown> | undefined)?.handoff_phone
    if (telefonoTransferencia !== undefined && String(telefonoTransferencia ?? '').trim() && !isRealClientPhone(telefonoTransferencia)) {
      return NextResponse.json({ error: 'El número para transferir no es válido: escríbelo con el código del país, por ejemplo +56912345678' }, { status: 400 })
    }

    const enlaceResena = (body.settings as Record<string, unknown> | undefined)?.google_review_url
    if (enlaceResena !== undefined && String(enlaceResena ?? '').trim() && !esEnlaceDeResena(enlaceResena)) {
      return NextResponse.json({ error: 'El enlace de reseñas tiene que empezar por https:// (cópialo desde tu ficha de Google)' }, { status: 400 })
    }

    const allowed = ['name','timezone','currency','phone','email','address','maps_url','logo_url','settings','agent_settings']
    const changes = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)))
    let result = await db.from('businesses').update({ ...changes, updated_at: new Date().toISOString() }).eq('id',businessId).select().single()
    if (result.error && Object.prototype.hasOwnProperty.call(changes,'maps_url')) {
      const withoutMaps = { ...changes }
      delete withoutMaps.maps_url
      result = await db.from('businesses').update({ ...withoutMaps, updated_at: new Date().toISOString() }).eq('id',businessId).select().single()
    }
    if (result.error) throw result.error
    return NextResponse.json({ business: { ...result.data, maps_url: result.data.maps_url ?? null } })
  } catch (error) { return apiError(error) }
}
