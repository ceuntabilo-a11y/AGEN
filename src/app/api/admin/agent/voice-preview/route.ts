import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resolveDashScopeKey } from '@/lib/openai'
import { generateSpeech } from '@/lib/voice'

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json().catch(() => ({})) as { text?: string }
    const text = (body.text?.trim() || '').slice(0, 500) || null
    if (!text) return NextResponse.json({ error: 'Escribe un texto para probar la voz.' }, { status: 400 })
    const { data: business, error } = await db.from('businesses').select('agent_settings,dashscope_api_key,dashscope_endpoint,name').eq('id', businessId).single()
    if (error) throw error
    const voice = ((business.agent_settings ?? {}) as { voice?: Record<string, unknown> }).voice ?? {}
    const { key, endpoint } = await resolveDashScopeKey(business.dashscope_api_key, business.dashscope_endpoint)
    if (!key) return NextResponse.json({ error: 'Configura tu clave de voz (DashScope/Qwen) en Integraciones antes de probar.' }, { status: 400 })
    const audio = await generateSpeech(text, voice, key, endpoint)
    return NextResponse.json({ audio: audio.audioBase64, mime: audio.mime })
  } catch (error) {
    if (error instanceof Error && /qwen_/.test(error.message)) return NextResponse.json({ error: 'El proveedor de voz no respondió correctamente. Revisa tu clave.' }, { status: 502 })
    return apiError(error)
  }
}
