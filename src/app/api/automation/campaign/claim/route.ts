import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const db = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('campaigns')
    .select('id,business_id')
    .eq('status', 'SCHEDULED')
    .lte('scheduled_at', now)
    .order('scheduled_at')
    .limit(20)
  if (error) return NextResponse.json({ error: 'No se pudieron consultar campañas' }, { status: 500 })

  const claimed: typeof data = []
  for (const campaign of data ?? []) {
    const { data: updated } = await db
      .from('campaigns')
      .update({ status: 'SENDING' })
      .eq('id', campaign.id)
      .eq('status', 'SCHEDULED')
      .select('id,business_id')
      .maybeSingle()
    if (updated) claimed.push(updated)
  }
  return NextResponse.json({ campaigns: claimed.map((campaign) => ({ id: campaign.id, businessId: campaign.business_id })) })
}
