import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'
import { slugValido, vencimientoDesdeDuracion } from '@/lib/platform-business'
import { actualizarNegocio } from '@/lib/platform-schema'

export const dynamic = 'force-dynamic'

const esFecha = (valor: unknown): valor is string => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)

/**
 * Editar un negocio ya creado.
 *
 * Antes solo se podían tocar tres cosas —activo, suspendido y plan—, así que un nombre mal
 * escrito, una zona horaria equivocada o una demo que había que alargar obligaban a borrar el
 * negocio y crearlo otra vez, perdiendo su agenda.
 *
 * Lista blanca explícita (CLAUDE.md §3): el cuerpo nunca se pasa directo a la base.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePlatformAdmin()
    const { id } = await params
    const body = await request.json() as {
      name?: string; slug?: string; timezone?: string; currency?: string; logoUrl?: string | null
      active?: boolean; suspended?: boolean; planId?: string | null
      isDemo?: boolean; startsOn?: string; durationDays?: number | null; expiresOn?: string | null
      converted?: boolean
    }

    const cambios: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const nombre = String(body.name).trim()
      if (!nombre) return NextResponse.json({ error: 'El nombre no puede quedar vacío' }, { status: 400 })
      cambios.name = nombre
    }
    if (body.slug !== undefined) {
      const slug = String(body.slug).trim()
      if (!slugValido(slug)) return NextResponse.json({ error: 'La dirección web solo admite minúsculas, números y guiones' }, { status: 400 })
      cambios.slug = slug
    }
    if (body.timezone !== undefined) cambios.timezone = String(body.timezone)
    if (body.currency !== undefined) cambios.currency = String(body.currency).toUpperCase()
    if (body.logoUrl !== undefined) cambios.logo_url = body.logoUrl || null
    if (body.active !== undefined) cambios.active = body.active
    if (body.suspended !== undefined) cambios.suspended_at = body.suspended ? new Date().toISOString() : null
    if (body.planId !== undefined) cambios.plan_id = body.planId
    if (body.isDemo !== undefined) cambios.is_demo = body.isDemo === true
    if (body.startsOn !== undefined) {
      if (!esFecha(body.startsOn)) return NextResponse.json({ error: 'La fecha de inicio no es válida' }, { status: 400 })
      cambios.starts_on = body.startsOn
    }

    /*
     * El vencimiento se puede fijar de dos formas y una gana: una fecha exacta manda sobre una
     * duración en días. `expiresOn: null` es "sin vencimiento", que es distinto de no mandarlo.
     */
    if (body.expiresOn !== undefined) {
      if (body.expiresOn !== null && !esFecha(body.expiresOn)) return NextResponse.json({ error: 'La fecha de vencimiento no es válida' }, { status: 400 })
      cambios.expires_on = body.expiresOn
    } else if (body.durationDays !== undefined) {
      const inicio = esFecha(body.startsOn) ? body.startsOn : null
      const base = inicio ?? (await db.from('businesses').select('starts_on').eq('id', id).single()).data?.starts_on ?? new Date().toISOString().slice(0, 10)
      cambios.expires_on = vencimientoDesdeDuracion(base, body.durationDays)
    }

    // Marcar la conversión de una demo: es lo que alimenta la tasa de conversión del panel.
    if (body.converted !== undefined) {
      cambios.converted_at = body.converted ? new Date().toISOString() : null
      if (body.converted) cambios.is_demo = false
    }

    if (Object.keys(cambios).length === 0) return NextResponse.json({ error: 'No enviaste ningún cambio' }, { status: 400 })

    const inicioFinal = (cambios.starts_on as string | undefined)
    const venceFinal = (cambios.expires_on as string | null | undefined)
    if (inicioFinal && venceFinal && venceFinal < inicioFinal) {
      return NextResponse.json({ error: 'El vencimiento no puede ser anterior al inicio' }, { status: 400 })
    }

    const { data, error } = await actualizarNegocio(db, id, cambios)
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Ya existe un negocio con esa dirección web' }, { status: 409 })
      throw error
    }
    return NextResponse.json({ business: data })
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePlatformAdmin()
    const { id } = await params
    const body = await request.json().catch(() => ({})) as { confirm?: string }
    const { data: business, error: businessError } = await db.from('businesses').select('id,name').eq('id', id).single()
    if (businessError) throw businessError
    if (body.confirm?.trim() !== business.name) return NextResponse.json({ error: 'Escribe el nombre exacto del negocio para confirmar la eliminación' }, { status: 400 })
    const { data: members } = await db.from('business_members').select('user_id').eq('business_id', id)
    const { error: deleteError } = await db.from('businesses').delete().eq('id', id)
    if (deleteError) throw deleteError
    for (const member of members ?? []) {
      const { count } = await db.from('business_members').select('id', { count: 'exact', head: true }).eq('user_id', member.user_id)
      if (!count) { try { await db.auth.admin.deleteUser(member.user_id) } catch { } }
    }
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
