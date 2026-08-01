import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function GET(request:Request){
  const url=new URL(request.url),code=url.searchParams.get('code')
  if(!code)return NextResponse.redirect(new URL('/login?error=invalid_callback',request.url))
  const db=createServerSupabase();const {error}=await db.auth.exchangeCodeForSession(code)
  if(error)return NextResponse.redirect(new URL('/login?error=callback_failed',request.url))
  const next=url.searchParams.get('next')
  return NextResponse.redirect(new URL(next?.startsWith('/')?next:'/auth/set-password',request.url))
}
