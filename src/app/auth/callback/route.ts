import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const base = process.env.NEXT_PUBLIC_APP_URL || url.origin
  const code = url.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/login?error=invalid_callback', base))
  const db = await createServerSupabase()
  const { error } = await db.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(new URL('/login?error=callback_failed', base))
  const next = url.searchParams.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/auth/set-password'
  return NextResponse.redirect(new URL(safeNext, base))
}
