import type { SupabaseClient } from '@supabase/supabase-js'

export const PROMO_KEYS = ['referral_headline', 'referral_percent', 'referral_terms'] as const

export type ReferralPromo = { headline: string; percent: number; terms: string }

export const DEFAULT_PROMO: ReferralPromo = {
  headline: 'Invita a un negocio y gana 20% de descuento en tu próxima facturación',
  percent: 20,
  terms: 'El descuento se aplica una vez que el negocio invitado crea su cuenta y el equipo de Agen lo confirma.',
}

/** El texto y el porcentaje los define la plataforma: el descuento lo paga Agen, no cada negocio. */
export async function readPromo(db: SupabaseClient): Promise<ReferralPromo> {
  const { data, error } = await db.from('platform_settings').select('key,value').in('key', PROMO_KEYS as unknown as string[])
  if (error) return DEFAULT_PROMO
  const value = (key: string) => data?.find((row) => row.key === key)?.value ?? null
  const percent = Number(value('referral_percent'))
  return {
    headline: value('referral_headline') || DEFAULT_PROMO.headline,
    percent: Number.isFinite(percent) && percent > 0 ? percent : DEFAULT_PROMO.percent,
    terms: value('referral_terms') || DEFAULT_PROMO.terms,
  }
}

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://agen.synetia.site').replace(/\/+$/, '')
}

export const businessInviteLink = (code: string) => `${appUrl()}/crear-negocio?ref=${encodeURIComponent(code)}`

export function clientInviteLink(slug: string, client?: { full_name?: string | null; phone?: string | null }) {
  const params = new URLSearchParams({ negocio: slug })
  if (client?.full_name) params.set('nombre', client.full_name)
  if (client?.phone) params.set('telefono', client.phone)
  return `${appUrl()}/registro?${params.toString()}`
}
