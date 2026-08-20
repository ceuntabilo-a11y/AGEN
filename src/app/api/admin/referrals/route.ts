import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { clientInviteLink, leadInviteLink, readPromo } from '@/lib/referrals'

export const dynamic = 'force-dynamic'

const missingColumn = (error: { code?: string } | null) => error?.code === '42703' || error?.code === '42P01'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const business = await db.from('businesses').select('slug,referral_code').eq('id', businessId).single()
    if (missingColumn(business.error)) return NextResponse.json({ pendingMigration: true })
    if (business.error) throw business.error

    const referrals = await db.from('business_referrals').select('id,referred_name,referred_email,status,reward_percent,rewarded_at,created_at,referred:businesses!business_referrals_referred_business_id_fkey(name)').eq('referrer_business_id', businessId).order('created_at', { ascending: false }).limit(100)
    if (referrals.error && !missingColumn(referrals.error)) throw referrals.error

    const promo = await readPromo(db)
    const code = business.data.referral_code as string | null
    return NextResponse.json({
      code,
      promo,
      businessLink: code ? leadInviteLink(code) : null,
      clientLink: business.data.slug ? clientInviteLink(business.data.slug) : null,
      referrals: referrals.data ?? [],
    })
  } catch (error) { return apiError(error) }
}

/** Deja anotado a quién se invitó, para poder seguirle el rastro antes de que se registre. */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as { name?: string; email?: string }
    const name = body.name?.trim().slice(0, 160)
    const email = body.email?.trim().toLowerCase().slice(0, 160) || null
    if (!name) return NextResponse.json({ error: 'El nombre del negocio invitado es obligatorio' }, { status: 400 })
    const promo = await readPromo(db)
    const { data, error } = await db.from('business_referrals').insert({
      referrer_business_id: businessId,
      referred_name: name,
      referred_email: email,
      status: 'PENDING',
      reward_percent: promo.percent,
    }).select('id,referred_name,status,created_at').single()
    if (missingColumn(error)) return NextResponse.json({ error: 'Falta aplicar la migración de invitaciones (supabase/migrations/20260806000002_referrals.sql)' }, { status: 503 })
    if (error) throw error
    return NextResponse.json({ referral: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta la invitación' }, { status: 400 })
    const { data, error } = await db.from('business_referrals').delete().eq('id', id).eq('referrer_business_id', businessId).eq('status', 'PENDING').select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Solo se pueden borrar invitaciones que todavía están pendientes' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
