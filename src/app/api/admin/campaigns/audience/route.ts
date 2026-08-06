import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resolveCampaignAudience } from '@/lib/campaign-audience'

export const dynamic = 'force-dynamic'

/** Cuánta gente recibiría la campaña con el canal y segmento elegidos, contando solo consentimientos vigentes. */
export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const params = new URL(request.url).searchParams
    const channel = params.get('channel') ?? 'WHATSAPP'
    const segment = params.get('segment') ?? 'ALL'
    if (!['WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'EMAIL', 'PUSH'].includes(channel)) return NextResponse.json({ error: 'Canal inválido' }, { status: 400 })
    if (!['ALL', 'ACTIVE', 'INACTIVE', 'BIRTHDAY'].includes(segment)) return NextResponse.json({ error: 'Segmento inválido' }, { status: 400 })
    const { eligible } = await resolveCampaignAudience(db, businessId, { channel, audience: { segment: segment as 'ALL' } })
    return NextResponse.json({ count: eligible.length })
  } catch (error) { return apiError(error) }
}
