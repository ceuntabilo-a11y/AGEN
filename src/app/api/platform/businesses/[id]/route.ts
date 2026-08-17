import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePlatformAdmin()
    const { id } = await params
    const body = await request.json() as { active?: boolean; suspended?: boolean; planId?: string | null }
    const changes: Record<string, unknown> = {}
    if (body.active !== undefined) changes.active = body.active
    if (body.suspended !== undefined) changes.suspended_at = body.suspended ? new Date().toISOString() : null
    if (body.planId !== undefined) changes.plan_id = body.planId
    if (Object.keys(changes).length === 0) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 })
    const { data, error } = await db.from('businesses').update(changes).eq('id', id).select().single()
    if (error) throw error
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
