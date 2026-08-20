import type { SupabaseClient } from '@supabase/supabase-js'

export const PROMO_KEYS = ['referral_enabled', 'referral_headline', 'referral_percent', 'referral_terms'] as const

export type ReferralPromo = { enabled: boolean; headline: string; percent: number; terms: string }

export const DEFAULT_PROMO: ReferralPromo = {
  enabled: true,
  headline: 'Invita a un negocio y gana 20% de descuento en tu próxima facturación',
  percent: 20,
  terms: 'El descuento se aplica una vez que el negocio invitado se une a Agen y el equipo lo confirma.',
}

/**
 * El texto, el porcentaje y si está activa los define la plataforma: el descuento lo paga
 * Agen, no cada negocio. `enabled` en `false` es la única forma de apagar el premio sin
 * tocar código — el dueño pidió que fuera editable, por si un mes quiere correr otra promoción
 * o directamente no ofrecer nada.
 */
export async function readPromo(db: SupabaseClient): Promise<ReferralPromo> {
  const { data, error } = await db.from('platform_settings').select('key,value').in('key', PROMO_KEYS as unknown as string[])
  if (error) return DEFAULT_PROMO
  const value = (key: string) => data?.find((row) => row.key === key)?.value ?? null
  const percent = Number(value('referral_percent'))
  const enabled = value('referral_enabled')
  return {
    enabled: enabled === null ? DEFAULT_PROMO.enabled : enabled !== false && enabled !== 'false',
    headline: value('referral_headline') || DEFAULT_PROMO.headline,
    percent: Number.isFinite(percent) && percent > 0 ? percent : DEFAULT_PROMO.percent,
    terms: value('referral_terms') || DEFAULT_PROMO.terms,
  }
}

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://agen.synetia.site').replace(/\/+$/, '')
}

/**
 * El enlace que se comparte para invitar a otro dueño de negocio. Ya no lleva directo a crear
 * la cuenta: pide que lo contacten, y recién después de la entrevista de descubrimiento se le
 * manda el enlace real de alta (`businessInviteLink`), que sigue existiendo para ese paso.
 */
export const leadInviteLink = (code: string) => `${appUrl()}/hablemos?ref=${encodeURIComponent(code)}`

export const businessInviteLink = (code: string) => `${appUrl()}/crear-negocio?ref=${encodeURIComponent(code)}`

export function clientInviteLink(slug: string, client?: { full_name?: string | null; phone?: string | null }) {
  const params = new URLSearchParams({ negocio: slug })
  if (client?.full_name) params.set('nombre', client.full_name)
  if (client?.phone) params.set('telefono', client.phone)
  return `${appUrl()}/registro?${params.toString()}`
}
