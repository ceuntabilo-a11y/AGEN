import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await createServerSupabase()
    const { data: { user } } = await session.auth.getUser()
    if (!user) return NextResponse.json({ ok: false }, { status: 401 })
    const { error } = await createAdminClient().from('businesses').select('id').limit(1)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
