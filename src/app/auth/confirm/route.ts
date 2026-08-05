import { NextResponse } from 'next/server'
import { type EmailOtpType } from '@supabase/supabase-js'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const base = process.env.NEXT_PUBLIC_APP_URL || url.origin
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = url.searchParams.get('next')
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/auth/set-password'
  if (!tokenHash || !type) return NextResponse.redirect(new URL('/login?error=invalid_callback', base))
  const db = await createServerSupabase()
  const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error) return NextResponse.redirect(new URL('/login?error=callback_failed', base))
  return NextResponse.redirect(new URL(safeNext, base))
}
