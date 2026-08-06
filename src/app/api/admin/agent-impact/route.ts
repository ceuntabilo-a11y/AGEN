import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

/** Cuánto trabajo hizo el agente en los últimos 30 días, con cifras de la base, nunca estimadas. */
export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const since = new Date(Date.now() - 30 * 86400000).toISOString()

    const [conversations, openConversations, humanConversations, agentAppointments, allAppointments, revenue] = await Promise.all([
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('created_at', since),
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('status', 'OPEN'),
      db.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('status', 'HUMAN'),
      db.from('appointments').select('quoted_price').eq('business_id', businessId).eq('source', 'AI_AGENT').gte('created_at', since),
      db.from('appointments').select('id', { count: 'exact', head: true }).eq('business_id', businessId).gte('created_at', since),
      db.from('businesses').select('currency').eq('id', businessId).single(),
    ])
    const failure = conversations.error || openConversations.error || humanConversations.error || agentAppointments.error || allAppointments.error
    if (failure) throw failure

    const agentRows = agentAppointments.data ?? []
    const total = allAppointments.count ?? 0
    return NextResponse.json({
      conversations: conversations.count ?? 0,
      open: openConversations.count ?? 0,
      human: humanConversations.count ?? 0,
      agentBookings: agentRows.length,
      totalBookings: total,
      share: total ? Math.round(agentRows.length / total * 100) : 0,
      agentRevenue: agentRows.reduce((sum, row) => sum + Number(row.quoted_price), 0),
      currency: revenue.data?.currency ?? 'CLP',
    })
  } catch (error) { return apiError(error) }
}
