import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { generateImage, resolveOpenAiKey } from '@/lib/openai'
import { rateLimited } from '@/lib/rate-limit'

/**
 * Genera un fondo con IA para la foto de un profesional (Tanda 7, opción elegida por el
 * dueño: recorte de fondo SIEMPRE con código, el fondo nuevo es lo único que puede venir de
 * IA, y solo si el dueño lo pide a propósito con su propio texto). Nunca devuelve personas: el
 * recorte del profesional se compone encima en el navegador, después de esto.
 */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    if (rateLimited(`professional-photo-bg:${businessId}`, 10, 60_000)) return NextResponse.json({ error: 'Demasiados intentos, espera un minuto' }, { status: 429 })

    const body = await request.json().catch(() => ({})) as { prompt?: string }
    const prompt = body.prompt?.trim().slice(0, 400)
    if (!prompt) return NextResponse.json({ error: 'Describe cómo quieres el fondo' }, { status: 400 })

    const { data: business } = await db.from('businesses').select('openai_api_key').eq('id', businessId).single()
    const { key } = await resolveOpenAiKey(business?.openai_api_key ?? null)
    if (!key) return NextResponse.json({ error: 'Configura tu clave de OpenAI en Integraciones para generar fondos con IA' }, { status: 400 })

    const image = await generateImage(
      key,
      `Fondo fotográfico realista para un retrato de estudio, sin ninguna persona, sin texto ni logos: ${prompt}`,
      { size: '1024x1536' },
    )
    return NextResponse.json({ image })
  } catch (error) { return apiError(error) }
}
