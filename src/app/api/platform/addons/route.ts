import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const { data, error } = await db.from('plan_addons').select('*').order('code')
    if (error) throw error
    return NextResponse.json({ addons: data })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as { id?: string; price?: number; active?: boolean }
    if (!body.id) return NextResponse.json({ error: 'Falta el complemento' }, { status: 400 })
    const changes: Record<string, unknown> = {}
    if (body.price !== undefined) changes.price = body.price
    if (body.active !== undefined) changes.active = body.active
    const { data, error } = await db.from('plan_addons').update(changes).eq('id', body.id).select().single()
    if (error) throw error
    return NextResponse.json({ addon: data })
  } catch (error) { return apiError(error) }
}
