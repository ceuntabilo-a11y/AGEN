import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { dateKeyInZone } from '@/lib/timezone'

type Audience = { segment?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'BIRTHDAY' }

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { businessId, campaignId } = await request.json() as { businessId?: string; campaignId?: string }
  if (!businessId || !campaignId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

  const db = createAdminClient()
  const { data: campaign, error } = await db.from('campaigns').select('*').eq('id', campaignId).eq('business_id', businessId).single()
  if (error) return NextResponse.json({ error: 'Campaña inexistente' }, { status: 404 })
  const { data: business } = await db.from('businesses').select('timezone').eq('id',businessId).single()

  const channel = campaign.channel as string
  const segment = ((campaign.audience as Audience | null)?.segment ?? 'ALL').toUpperCase()
  let clientsResult = await db
    .from('clients')
    .select('id,full_name,phone,email,birthday,marketing_unsubscribe_token,communication_consents!inner(channel,purpose,granted)')
    .eq('business_id', businessId)
    .eq('communication_consents.channel', channel)
    .eq('communication_consents.purpose', 'MARKETING')
    .eq('communication_consents.granted', true)
    .limit(5000)
  if (clientsResult.error) clientsResult = await db
    .from('clients')
    .select('id,full_name,phone,email,birthday,communication_consents!inner(channel,purpose,granted)')
    .eq('business_id', businessId)
    .eq('communication_consents.channel', channel)
    .eq('communication_consents.purpose', 'MARKETING')
    .eq('communication_consents.granted', true)
    .limit(5000) as typeof clientsResult
  const { data: clients, error: clientsError } = clientsResult
  if (clientsError) return NextResponse.json({ error: 'No se pudo cargar la audiencia' }, { status: 500 })

  let segmentIds: Set<string> | null = null
  if (segment === 'ACTIVE' || segment === 'INACTIVE') {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - 180)
    const { data: visits, error: visitsError } = await db
      .from('appointments')
      .select('client_id')
      .eq('business_id', businessId)
      .eq('status', 'COMPLETED')
      .overlaps('service_period', `[${since.toISOString()},${new Date().toISOString()}]`)
    if (visitsError) return NextResponse.json({ error: 'No se pudo calcular el segmento' }, { status: 500 })
    segmentIds = new Set((visits ?? []).map((visit) => visit.client_id))
  }

  const currentMonth = Number(dateKeyInZone(new Date(),business?.timezone??'UTC').slice(5,7))
  const eligible = (clients ?? []).filter((client) => {
    const hasDestination = channel === 'EMAIL' ? Boolean(client.email) : Boolean(client.phone)
    if (!hasDestination) return false
    if (segment === 'ACTIVE') return segmentIds?.has(client.id) ?? false
    if (segment === 'INACTIVE') return !(segmentIds?.has(client.id) ?? false)
    if (segment === 'BIRTHDAY') return client.birthday ? Number(client.birthday.slice(5, 7)) === currentMonth : false
    return true
  })

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
