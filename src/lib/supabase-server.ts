import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-admin'

export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase no está configurado')
  const store = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values: { name: string; value: string; options: CookieOptions }[]) => {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)) } catch { }
      },
    },
  })
}

export async function requireBusinessContext(roles?: string[]) {
  const session = await createServerSupabase()
  const { data: { user } } = await session.auth.getUser()
  if (!user) throw new Error('UNAUTHORIZED')
  const db = createAdminClient()
  const { data: member, error } = await db.from('business_members').select('business_id,role,id').eq('user_id', user.id).eq('active', true).limit(1).maybeSingle()
  if (error || !member) throw new Error('FORBIDDEN')
  if (roles && !roles.includes(member.role)) throw new Error('FORBIDDEN')
  return { db, user, businessId: member.business_id as string, role: member.role as string, memberId: member.id as string }
}
