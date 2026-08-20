import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { apiError } from '@/lib/http-errors'
import { normalizePhone } from '@/lib/phone'
import { rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Página pública (sin sesión): alguien invitado por un negocio pide que Agen lo contacte.
 * No crea ninguna cuenta ni negocio — solo deja el dato para que el equipo de Agen llame,
 * como pidió el dueño (Tanda 8). El código de quien invitó es opcional: sin él, o si no
 * corresponde a ningún negocio real, el pedido se guarda igual, sin atribuir a nadie.
 */
export async function POST(request: Request) {
  try {
    if (rateLimited('leads:global', 30, 60_000)) return NextResponse.json({ error: 'Demasiados intentos, espera un minuto' }, { status: 429 })

    const body = await request.json().catch(() => ({})) as {
      name?: string; businessName?: string; businessType?: string; phone?: string; email?: string; referralCode?: string
    }
    const businessName = body.businessName?.trim().slice(0, 160)
    if (!businessName) return NextResponse.json({ error: 'El nombre del negocio es obligatorio' }, { status: 400 })
    const rawPhone = body.phone?.trim() ?? ''
    const phone = rawPhone ? normalizePhone(rawPhone) : null
    if (!phone) return NextResponse.json({ error: 'Escribe un teléfono válido, con el código del país (ej. +56912345678)' }, { status: 400 })

    const db = createAdminClient()
    const code = body.referralCode?.trim().toUpperCase()
    let referrerId: string | null = null
    if (code) {
      const { data: referrer } = await db.from('businesses').select('id').eq('referral_code', code).maybeSingle()
      referrerId = referrer?.id ?? null
    }
    // Sin código, o si no corresponde a ningún negocio real, el pedido se guarda igual, sin
    // atribuírselo a nadie: sigue viéndose en la bandeja de la plataforma.

    const { error } = await db.from('business_referrals').insert({
      referrer_business_id: referrerId,
      referred_name: body.name?.trim().slice(0, 160) || businessName,
      referred_email: body.email?.trim().toLowerCase().slice(0, 160) || null,
      referred_phone: phone,
      referred_business_type: body.businessType?.trim().slice(0, 120) || null,
      status: 'PENDING',
    })
    if (error) throw error
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) { return apiError(error) }
}
