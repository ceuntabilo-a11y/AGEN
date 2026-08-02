import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

export async function POST(request: Request) {
  const { token } = await request.json() as { token?: string }
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Enlace inválido' }, { status: 400 })
  const db = createAdminClient()
  const { data: client, error } = await db.from('clients').select('id').eq('marketing_unsubscribe_token',token).maybeSingle()
  if (error || !client) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 })
  await db.from('communication_consents').upsert({ client_id:client.id, channel:'EMAIL', purpose:'MARKETING', granted:false, source:'FORM', updated_at:new Date().toISOString() },{onConflict:'client_id,channel,purpose'})
  return NextResponse.json({ unsubscribed:true })
}
