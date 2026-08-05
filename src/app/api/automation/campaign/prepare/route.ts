import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { resolveCampaignAudience } from '@/lib/campaign-audience'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { businessId, campaignId } = await request.json() as { businessId?: string; campaignId?: string }
  if (!businessId || !campaignId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

  const db = createAdminClient()
  const { data: campaign, error } = await db.from('campaigns').select('*').eq('id', campaignId).eq('business_id', businessId).single()
  if (error) return NextResponse.json({ error: 'Campaña inexistente' }, { status: 404 })

  const channel = campaign.channel as string
  let eligible: Awaited<ReturnType<typeof resolveCampaignAudience>>['eligible']
  let segment: string
  try { ({ eligible, segment } = await resolveCampaignAudience(db, businessId, campaign)) }
  catch { return NextResponse.json({ error: 'No se pudo cargar la audiencia' }, { status: 500 }) }

  if (eligible.length) {
    await db.from('campaign_recipients').upsert(
      eligible.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING', reason: null, sent_at: null })),
      { onConflict: 'campaign_id,client_id' },
    )
  } else {
    await db.from('campaigns').update({ status: 'SENT', sent_at: new Date().toISOString() }).eq('id',campaignId).eq('business_id',businessId)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/,'')

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name, channel, content: campaign.content, segment },
    recipients: eligible.map((client) => ({ clientId: client.id, name: client.full_name, phone: client.phone, email: client.email, unsubscribeUrl: channel === 'EMAIL' && appUrl && (client as any).marketing_unsubscribe_token ? `${appUrl}/unsubscribe?token=${(client as any).marketing_unsubscribe_token}` : null })),
  })
}
