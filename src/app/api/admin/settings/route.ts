import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { validTimeZone } from '@/lib/timezone'

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
