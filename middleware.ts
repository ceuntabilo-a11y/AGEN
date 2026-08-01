import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.next()

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const membershipDb = serviceRoleKey
    ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : supabase
  const { data: member } = await membershipDb.from('business_members').select('role').eq('user_id', user.id).eq('active', true).limit(1).maybeSingle()
  const path = request.nextUrl.pathname
  if (path.startsWith('/admin') && !member?.role?.match(/OWNER|ADMIN|RECEPTIONIST/)) return NextResponse.redirect(new URL(member?.role === 'PROFESSIONAL' ? '/profesional' : '/cliente', request.url))
  if (path.startsWith('/profesional') && member?.role !== 'PROFESSIONAL') return NextResponse.redirect(new URL(member ? '/admin' : '/cliente', request.url))
  return response
}

export const config = { matcher: ['/admin/:path*', '/profesional/:path*', '/cliente/:path*'] }
