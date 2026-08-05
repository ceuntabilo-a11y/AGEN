import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const [businesses, professionals, appointments] = await Promise.all([
      db.from('businesses').select('id,active,suspended_at,membership_plans(price)'),
      db.from('professionals').select('id', { count: 'exact', head: true }).eq('active', true),
      db.from('appointments').select('id', { count: 'exact', head: true }).not('status', 'eq', 'CANCELLED'),
    ])
    if (businesses.error) throw businesses.error
    const rows = businesses.data ?? []
    const active = rows.filter(row => row.active && !row.suspended_at)
    const mrr = active.reduce((sum, row) => sum + Number((row as any).membership_plans?.price ?? 0), 0)
    let supabaseHealthy = true
    try { const ping = await db.from('businesses').select('id', { count: 'exact', head: true }).limit(1); supabaseHealthy = !ping.error } catch { supabaseHealthy = false }
    let n8nHealthy: boolean | null = null
    if (process.env.N8N_WEBHOOK_URL) { try { const response = await fetch(process.env.N8N_WEBHOOK_URL.replace(/\/webhook.*$/, '/healthz'), { signal: AbortSignal.timeout(4000) }); n8nHealthy = response.ok } catch { n8nHealthy = false } }
    return NextResponse.json({
      businesses: { total: rows.length, active: active.length, suspended: rows.filter(row => row.suspended_at).length },
      professionals: professionals.count ?? 0,
      appointments: appointments.count ?? 0,
      mrr,
      health: { supabase: supabaseHealthy, n8n: n8nHealthy },
    })
  } catch (error) { return apiError(error) }
}
