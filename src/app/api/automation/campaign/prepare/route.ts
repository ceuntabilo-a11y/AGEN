import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

type Audience = { segment?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'BIRTHDAY' }

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { businessId, campaignId } = await request.json() as { businessId?: string; campaignId?: string }
  if (!businessId || !campaignId) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

  const db = createAdminClient()
  const { data: campaign, error } = await db.from('campaigns').select('*').eq('id', campaignId).eq('business_id', businessId).single()
  if (error) return NextResponse.json({ error: 'Campaña inexistente' }, { status: 404 })

  const channel = campaign.channel as string
  const segment = ((campaign.audience as Audience | null)?.segment ?? 'ALL').toUpperCase()
  const { data: clients, error: clientsError } = await db
    .from('clients')
    .select('id,full_name,phone,email,birthday,communication_consents!inner(channel,purpose,granted)')
    .eq('business_id', businessId)
    .eq('communication_consents.channel', channel)
    .eq('communication_consents.purpose', 'MARKETING')
    .eq('communication_consents.granted', true)
    .limit(5000)
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
      .gte('start_at', since.toISOString())
    if (visitsError) return NextResponse.json({ error: 'No se pudo calcular el segmento' }, { status: 500 })
    segmentIds = new Set((visits ?? []).map((visit) => visit.client_id))
  }

  const currentMonth = new Date().getUTCMonth() + 1
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
      eligible.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING' })),
      { onConflict: 'campaign_id,client_id' },
    )
  }

  return NextResponse.json({
    campaign: { id: campaign.id, name: campaign.name, channel, content: campaign.content, segment },
    recipients: eligible.map((client) => ({ clientId: client.id, name: client.full_name, phone: client.phone, email: client.email })),
  })
}
