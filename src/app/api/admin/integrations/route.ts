import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resendConfigured } from '@/lib/resend'
import { esEnlaceDeResena } from '@/lib/agent-encuesta'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { data, error } = await db.from('businesses').select('whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key,openai_api_key,dashscope_api_key,dashscope_endpoint,feature_image,feature_voice,settings').eq('id', businessId).single()
    if (error) throw error
    return NextResponse.json({
      integrations: {
        ...data,
        whatsapp_token: data.whatsapp_token ? '••••••••' : null,
        whatsapp_360_api_key: data.whatsapp_360_api_key ? '••••••••' : null,
        openai_api_key: data.openai_api_key ? '••••••••' : null,
        dashscope_api_key: data.dashscope_api_key ? '••••••••' : null,
        google_review_url: (data.settings as Record<string, unknown> | null)?.google_review_url ?? null,
        resend_configured: await resendConfigured(),
        settings: undefined,
      },
    })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as Record<string, unknown>
    const allowed = ['whatsapp_provider', 'whatsapp_phone_id', 'whatsapp_token', 'whatsapp_360_api_key', 'openai_api_key', 'dashscope_api_key', 'dashscope_endpoint', 'feature_image', 'feature_voice']
    const changes: Record<string, unknown> = Object.fromEntries(Object.entries(body).filter(([key, value]) => allowed.includes(key) && value !== '••••••••'))
    if (changes.whatsapp_provider && !['EVOLUTION', 'META', 'DIALOG360'].includes(String(changes.whatsapp_provider))) return NextResponse.json({ error: 'Proveedor inválido' }, { status: 400 })
    if (changes.openai_api_key && !/^sk-/.test(String(changes.openai_api_key))) return NextResponse.json({ error: 'La clave de OpenAI debe empezar con sk-' }, { status: 400 })

    /*
     * El enlace de reseña vive en `settings` (jsonb), no en una columna propia: hay que leer lo
     * que ya está guardado y solo cambiar esta clave, para no pisar el resto (horario, marca,
     * recordatorios…) que administra `/admin/configuracion`.
     */
    if (body.google_review_url !== undefined) {
      const enlace = String(body.google_review_url ?? '').trim()
      if (enlace && !esEnlaceDeResena(enlace)) return NextResponse.json({ error: 'El enlace de reseñas tiene que empezar por https:// (cópialo desde tu ficha de Google)' }, { status: 400 })
      const { data: actual } = await db.from('businesses').select('settings').eq('id', businessId).single()
      changes.settings = { ...(actual?.settings as Record<string, unknown> ?? {}), google_review_url: enlace || null }
    }

    const { data, error } = await db.from('businesses').update(changes).eq('id', businessId).select('whatsapp_provider,whatsapp_instance,feature_image,feature_voice,settings').single()
    if (error) throw error
    return NextResponse.json({ integrations: { ...data, google_review_url: (data.settings as Record<string, unknown> | null)?.google_review_url ?? null, settings: undefined } })
  } catch (error) { return apiError(error) }
}
