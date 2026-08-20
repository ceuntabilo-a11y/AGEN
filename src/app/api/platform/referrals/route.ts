import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'
import { readPromo } from '@/lib/referrals'

export const dynamic = 'force-dynamic'

const missing = (error: { code?: string } | null) => error?.code === '42703' || error?.code === '42P01'

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const { data, error } = await db.from('business_referrals')
      .select('id,referred_name,referred_email,referred_phone,referred_business_type,status,reward_percent,reward_note,rewarded_at,created_at,referrer:businesses!business_referrals_referrer_business_id_fkey(id,name),referred:businesses!business_referrals_referred_business_id_fkey(id,name)')
      .order('created_at', { ascending: false }).limit(300)
    if (missing(error)) return NextResponse.json({ pendingMigration: true, referrals: [], promo: await readPromo(db) })
    if (error) throw error
    return NextResponse.json({ referrals: data ?? [], promo: await readPromo(db) })
  } catch (error) { return apiError(error) }
}

/** Confirmar el premio es manual a propósito: nadie gana descuento por registrar cuentas falsas. */
export async function PATCH(request: Request) {
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as { id?: string; status?: string; note?: string; percent?: number }
    if (!body.id || !body.status) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })
    if (!['PENDING', 'REGISTERED', 'REWARDED', 'CANCELLED'].includes(body.status)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
    const changes: Record<string, unknown> = { status: body.status, rewarded_at: body.status === 'REWARDED' ? new Date().toISOString() : null }
    if (body.note !== undefined) changes.reward_note = body.note?.slice(0, 300) || null
    if (body.percent !== undefined) {
      const percent = Number(body.percent)
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return NextResponse.json({ error: 'El porcentaje debe estar entre 0 y 100' }, { status: 400 })
      changes.reward_percent = percent
    }
    const { data, error } = await db.from('business_referrals').update(changes).eq('id', body.id).select('id,status,rewarded_at').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Esa invitación no existe' }, { status: 404 })
    return NextResponse.json({ referral: data })
  } catch (error) { return apiError(error) }
}
