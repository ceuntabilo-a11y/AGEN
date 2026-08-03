import { createServerSupabase } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function requireClientContext() {
  const session = await createServerSupabase()
  const { data: { user } } = await session.auth.getUser()
  if (!user) throw new Error('UNAUTHORIZED')
  const db = createAdminClient()
  const { data: client, error } = await db.from('clients').select('id,business_id,full_name,phone,email').eq('user_id', user.id).limit(1).maybeSingle()
  if (error || !client) throw new Error('FORBIDDEN')
  return { db, user, clientId: client.id as string, businessId: client.business_id as string, client }
}
