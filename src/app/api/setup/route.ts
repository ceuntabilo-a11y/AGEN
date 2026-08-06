import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { readPromo } from '@/lib/referrals'
import { sendMarketingEmail } from '@/lib/resend'

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
      const { data: referrer } = await admin.from('businesses').select('id,name,email').eq('referral_code', code).maybeSingle()
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
        // Aviso a quien invitó, para que no tenga que estar mirando el panel.
        if (referrer.email) {
          await sendMarketingEmail({
            to: referrer.email,
            subject: `${body.name!.trim()} se registró con tu invitación`,
            businessName: 'Agen',
            html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <p style="font-weight:800;font-size:18px;margin:0 0 16px">Tu invitación funcionó</p>
              <p style="margin:0 0 12px"><b>${body.name!.trim()}</b> acaba de crear su cuenta en Agen con tu enlace.</p>
              <p style="margin:0 0 12px">Tu ${promo.percent}% de descuento queda registrado y el equipo de Agen lo aplica en tu próxima facturación.</p>
              <p style="margin:0;color:#888;font-size:12px">Puedes ver el estado de tus invitaciones en Agen, en la sección Invitar.</p>
            </div>`,
          })
        }
      }
    } catch { /* el negocio ya quedó creado: una invitación no registrada nunca bloquea el alta */ }
  }
  return NextResponse.json({ businessId: data }, { status: 201 })
}
