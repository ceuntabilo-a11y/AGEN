import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { chatCompletion, resolveOpenAiKey } from '@/lib/openai'
import { rateLimited } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    if (rateLimited(`campaign-generate:${businessId}`, 20, 60_000)) return NextResponse.json({ error: 'Demasiados intentos, espera un minuto' }, { status: 429 })
    const body = await request.json().catch(() => ({})) as { description?: string; channel?: string }
    const description = body.description?.trim().slice(0, 500)
    if (!description) return NextResponse.json({ error: 'Describe qué quieres promocionar' }, { status: 400 })
    const { data: business, error } = await db.from('businesses').select('name,openai_api_key').eq('id', businessId).single()
    if (error) throw error
    const { key } = await resolveOpenAiKey(business.openai_api_key)
    if (!key) return NextResponse.json({ error: 'Configura tu clave de OpenAI en Integraciones para usar el generador' }, { status: 400 })
    const channel = body.channel === 'EMAIL' ? 'un correo' : 'un mensaje de WhatsApp'
    const content = await chatCompletion(key, [
      { role: 'system', content: `Escribes ${channel} promocional corto para un negocio de servicios llamado "${business.name}". Español, cercano, sin inventar precios ni datos que el negocio no dio, máximo 400 caracteres, sin emojis excesivos (máximo 2).` },
      { role: 'user', content: description },
    ], { maxTokens: 220 })
    return NextResponse.json({ content })
  } catch (error) { return apiError(error) }
}
