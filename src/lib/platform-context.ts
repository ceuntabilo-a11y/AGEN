import { createServerSupabase } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function requirePlatformAdmin() {
  const session = await createServerSupabase()
  const { data: { user } } = await session.auth.getUser()
  if (!user) throw new Error('UNAUTHORIZED')
  const db = createAdminClient()
  const { data: admin, error } = await db.from('platform_admins').select('id').eq('user_id', user.id).eq('active', true).maybeSingle()
  if (error || !admin) throw new Error('FORBIDDEN')
  return { db, user }
}
