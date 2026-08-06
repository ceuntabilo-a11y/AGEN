import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { chatCompletion, resolveOpenAiKey } from '@/lib/openai'
import { rateLimited } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    if (rateLimited(`campaign-generate:${businessId}`, 20, 60_000)) return NextResponse.json({ error: 'Demasiados intentos, espera un minuto' }, { status: 429 })
    const body = await request.json().catch(() => ({})) as { description?: string; channel?: string; mode?: string; content?: string }
    const description = body.description?.trim().slice(0, 500)
    if (!description) return NextResponse.json({ error: 'Describe qué quieres promocionar' }, { status: 400 })
    const { data: business, error } = await db.from('businesses').select('name,openai_api_key').eq('id', businessId).single()
    if (error) throw error
    const { key } = await resolveOpenAiKey(business.openai_api_key)
    if (!key) return NextResponse.json({ error: 'Configura tu clave de OpenAI en Integraciones para usar el generador' }, { status: 400 })

    // Modo diseño: convierte el texto ya aprobado en un correo HTML listo para enviar.
    if (body.mode === 'email-design') {
      const base = body.content?.trim().slice(0, 1500) || description
      const html = await chatCompletion(key, [
        { role: 'system', content: `Devuelves SOLO HTML de un correo promocional para "${business.name}", sin explicaciones ni bloques de código. Reglas: HTML de correo (tablas o divs con estilos en línea, nada de <style>, <script> ni fuentes externas), ancho máximo 600px, español, un solo botón de acción como enlace, y al final un pie pequeño con el texto "Dejar de recibir promociones" enlazado a {{unsubscribeUrl}}. No inventes precios, direcciones ni datos que no estén en el mensaje.` },
        { role: 'user', content: base },
      ], { maxTokens: 1200 })
      const clean = html.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim()
      const subject = await chatCompletion(key, [
        { role: 'system', content: 'Devuelves SOLO el asunto de un correo promocional en español, máximo 60 caracteres, sin comillas ni emojis.' },
        { role: 'user', content: base },
      ], { maxTokens: 40 })
      return NextResponse.json({ html: clean, subject: subject.trim().replace(/^"|"$/g, '').slice(0, 120) })
    }

    const channel = body.channel === 'EMAIL' ? 'un correo' : 'un mensaje de WhatsApp'
    const content = await chatCompletion(key, [
      { role: 'system', content: `Escribes ${channel} promocional corto para un negocio de servicios llamado "${business.name}". Español, cercano, sin inventar precios ni datos que el negocio no dio, máximo 400 caracteres, sin emojis excesivos (máximo 2).` },
      { role: 'user', content: description },
    ], { maxTokens: 220 })
    return NextResponse.json({ content })
  } catch (error) { return apiError(error) }
}
