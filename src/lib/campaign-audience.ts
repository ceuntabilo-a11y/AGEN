import { createAdminClient } from '@/lib/supabase-admin'
import { dateKeyInZone } from '@/lib/timezone'

type Audience = { segment?: 'ALL' | 'ACTIVE' | 'INACTIVE' | 'BIRTHDAY' }
type Client = { id: string; full_name: string; phone: string | null; email: string | null; birthday: string | null; marketing_unsubscribe_token?: string | null }

export async function resolveCampaignAudience(db: ReturnType<typeof createAdminClient>, businessId: string, campaign: { channel: string; audience: Audience | null }) {
  const channel = campaign.channel
  const segment = (campaign.audience?.segment ?? 'ALL').toUpperCase()
  const { data: business } = await db.from('businesses').select('timezone').eq('id', businessId).single()

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
  if (clientsError) throw clientsError

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
    if (visitsError) throw visitsError
    segmentIds = new Set((visits ?? []).map((visit) => visit.client_id))
  }

  const currentMonth = Number(dateKeyInZone(new Date(), business?.timezone ?? 'UTC').slice(5, 7))
  const eligible = ((clients ?? []) as Client[]).filter((client) => {
    const hasDestination = channel === 'EMAIL' ? Boolean(client.email) : Boolean(client.phone)
    if (!hasDestination) return false
    if (segment === 'ACTIVE') return segmentIds?.has(client.id) ?? false
    if (segment === 'INACTIVE') return !(segmentIds?.has(client.id) ?? false)
    if (segment === 'BIRTHDAY') return client.birthday ? Number(client.birthday.slice(5, 7)) === currentMonth : false
    return true
  })
  return { eligible, segment }
}
