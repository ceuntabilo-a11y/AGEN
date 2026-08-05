import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resendConfigured } from '@/lib/resend'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { data, error } = await db.from('businesses').select('whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key,openai_api_key,dashscope_api_key,dashscope_endpoint,feature_image,feature_voice').eq('id', businessId).single()
    if (error) throw error
    return NextResponse.json({ integrations: { ...data, whatsapp_token: data.whatsapp_token ? '••••••••' : null, whatsapp_360_api_key: data.whatsapp_360_api_key ? '••••••••' : null, openai_api_key: data.openai_api_key ? '••••••••' : null, dashscope_api_key: data.dashscope_api_key ? '••••••••' : null, resend_configured: await resendConfigured() } })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as Record<string, unknown>
    const allowed = ['whatsapp_provider', 'whatsapp_phone_id', 'whatsapp_token', 'whatsapp_360_api_key', 'openai_api_key', 'dashscope_api_key', 'dashscope_endpoint', 'feature_image', 'feature_voice']
    const changes = Object.fromEntries(Object.entries(body).filter(([key, value]) => allowed.includes(key) && value !== '••••••••'))
    if (changes.whatsapp_provider && !['EVOLUTION', 'META', 'DIALOG360'].includes(String(changes.whatsapp_provider))) return NextResponse.json({ error: 'Proveedor inválido' }, { status: 400 })
    if (changes.openai_api_key && !/^sk-/.test(String(changes.openai_api_key))) return NextResponse.json({ error: 'La clave de OpenAI debe empezar con sk-' }, { status: 400 })
    const { data, error } = await db.from('businesses').update(changes).eq('id', businessId).select('whatsapp_provider,whatsapp_instance,feature_image,feature_voice').single()
    if (error) throw error
    return NextResponse.json({ integrations: data })
  } catch (error) { return apiError(error) }
}
