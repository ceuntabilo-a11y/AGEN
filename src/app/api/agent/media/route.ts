import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { resolveOpenAiKey } from '@/lib/openai'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { businessId?: string; mediaType?: 'image' | 'audio' | null; mediaUrl?: string | null }
  if (!body.businessId || !body.mediaType || !body.mediaUrl) return NextResponse.json({ text: null })

  try {
    const db = createAdminClient()
    const { data: business } = await db.from('businesses').select('feature_image,feature_voice,openai_api_key').eq('id', body.businessId).single()
    if (!business) return NextResponse.json({ text: null })
    if (body.mediaType === 'image' && !business.feature_image) return NextResponse.json({ text: '(el cliente envió una imagen, pero esta función está desactivada)' })
    if (body.mediaType === 'audio' && !business.feature_voice) return NextResponse.json({ text: '(el cliente envió una nota de voz, pero esta función está desactivada)' })

    const { key } = await resolveOpenAiKey(business.openai_api_key)
    if (!key) return NextResponse.json({ text: null })

    if (body.mediaType === 'audio') {
      const audio = await fetch(body.mediaUrl, { signal: AbortSignal.timeout(15000) })
      if (!audio.ok) return NextResponse.json({ text: null })
      const blob = await audio.blob()
      const form = new FormData()
      form.append('file', blob, 'audio.ogg')
      form.append('model', 'whisper-1')
      const transcription = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(20000) })
      if (!transcription.ok) return NextResponse.json({ text: null })
      const data = await transcription.json() as { text?: string }
      return NextResponse.json({ text: data.text?.trim() || null })
    }

    const vision = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe brevemente esta imagen que envió un cliente por WhatsApp a un negocio de servicios. Si es un comprobante de pago, extrae monto, fecha y referencia si se ven. Responde en español, breve.' }, { type: 'image_url', image_url: { url: body.mediaUrl } }] }] }),
      signal: AbortSignal.timeout(20000),
    })
    if (!vision.ok) return NextResponse.json({ text: null })
    const data = await vision.json() as { choices?: { message?: { content?: string } }[] }
    return NextResponse.json({ text: data.choices?.[0]?.message?.content?.trim() || null })
  } catch { return NextResponse.json({ text: null }) }
}
