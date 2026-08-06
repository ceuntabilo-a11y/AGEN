import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { readPromo } from '@/lib/referrals'

export async function POST(request: Request) {
  const db = await createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Debes iniciar sesión' }, { status: 401 })

  const body = await request.json() as {
    name?: string
    slug?: string
    timezone?: string
    currency?: string
    phone?: string
    address?: string
    referralCode?: string
  }
  if (!body.name?.trim() || !body.slug?.trim()) return NextResponse.json({ error: 'Nombre y código son obligatorios' }, { status: 400 })

  const { data, error } = await db.rpc('create_business_for_owner', {
    p_name: body.name.trim(),
    p_slug: body.slug.trim().toLowerCase(),
    p_timezone: body.timezone || 'America/Santiago',
    p_currency: body.currency || 'CLP',
    p_phone: body.phone?.trim() || null,
    p_email: user.email || null,
    p_address: body.address?.trim() || null,
  })
  if (error) {
    if (error.message.includes('businesses_slug_key')) return NextResponse.json({ error: 'Ese código de negocio ya está ocupado' }, { status: 409 })
    if (error.message.includes('USER_ALREADY_HAS_BUSINESS')) return NextResponse.json({ error: 'Tu cuenta ya pertenece a un negocio' }, { status: 409 })
    return NextResponse.json({ error: 'No se pudo crear el negocio' }, { status: 500 })
  }
  // Invitación entre negocios: queda anotada como REGISTERED y el equipo de Agen confirma el premio.
  const code = body.referralCode?.trim().toUpperCase()
  if (code) {
    try {
      const admin = createAdminClient()
      const { data: referrer } = await admin.from('businesses').select('id').eq('referral_code', code).maybeSingle()
      if (referrer && referrer.id !== data) {
        const promo = await readPromo(admin)
        await admin.from('business_referrals').insert({
          referrer_business_id: referrer.id,
          referred_business_id: data,
          referred_name: body.name!.trim(),
          referred_email: user.email ?? null,
          status: 'REGISTERED',
          reward_percent: promo.percent,
        })
      }
    } catch { /* el negocio ya quedó creado: una invitación no registrada nunca bloquea el alta */ }
  }
  return NextResponse.json({ businessId: data }, { status: 201 })
}
