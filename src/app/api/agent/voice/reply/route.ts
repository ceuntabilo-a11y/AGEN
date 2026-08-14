import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { resolveDashScopeKey } from '@/lib/openai'
import { generateSpeech } from '@/lib/voice'
import { registrarAviso, registrarError } from '@/lib/observabilidad'

/**
 * Motivos que NO son un fallo: el negocio configuró la voz así. Se distinguen para que en los
 * logs se pueda buscar "la voz no salió porque algo se rompió" sin ahogarse en las veces que
 * simplemente estaba apagada.
 */
const MOTIVOS_ESPERADOS = new Set(['voz_desactivada', 'solo_si_hablo_por_voz', 'modo_equipo_solo_texto', 'datos_incompletos'])

export async function POST(request: Request) {
  let negocio: string | undefined
  const textOnly = (reason: string) => {
    if (!MOTIVOS_ESPERADOS.has(reason)) registrarAviso('agent_voz_sin_audio', { businessId: negocio, motivo: reason })
    return NextResponse.json({ speak: false, sendText: true, reason })
  }
  try {
    if (!isAuthorizedAgent(request)) return NextResponse.json({ speak: false, sendText: true, reason: 'no_autorizado' }, { status: 401 })
    const body = await request.json().catch(() => ({})) as { businessId?: string; text?: string; wasAudio?: boolean; actorType?: string }
    const text = String(body.text || '').trim()
    negocio = body.businessId
    if (!body.businessId || !text) return textOnly('datos_incompletos')
    if (body.actorType === 'TEAM') return textOnly('modo_equipo_solo_texto')

    const db = createAdminClient()
    const { data: business } = await db.from('businesses').select('agent_settings,dashscope_api_key,dashscope_endpoint').eq('id', body.businessId).single()
    if (!business) return textOnly('negocio_inexistente')
    const settings = (business.agent_settings ?? {}) as { voice?: Record<string, unknown>; behavior?: Record<string, unknown> }
    const voice = settings.voice ?? {}
    const behavior = settings.behavior ?? {}
    if (!voice.enabled || !behavior.respond_voice) return textOnly('voz_desactivada')
    if (behavior.respond_voice_only_if_voice !== false && !body.wasAudio) return textOnly('solo_si_hablo_por_voz')

    const maxSeconds = Number(behavior.max_duration_seconds ?? 30)
    const maxChars = Math.max(60, Math.round(maxSeconds * 14))
    if (text.length > maxChars) return textOnly('texto_demasiado_largo')

    const { key, endpoint } = await resolveDashScopeKey(business.dashscope_api_key, business.dashscope_endpoint)
    if (!key) return textOnly('sin_clave_voz')

    const audio = await generateSpeech(text, voice, key, endpoint)
    return NextResponse.json({ speak: true, sendText: behavior.also_send_text !== false, audio: audio.audioBase64, mime: audio.mime, chars: audio.chars })
  } catch (error) {
    // Este es el que de verdad importa: DashScope caído, clave caducada o cuota agotada. El
    // cliente sigue recibiendo texto, así que sin este registro nadie se enteraría nunca.
    registrarError('agent_voz_excepcion', { businessId: negocio, error })
    return textOnly('error_generando_voz')
  }
}
