import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDashScopeKey } from '@/lib/openai'
import { generateSpeech } from '@/lib/voice'
import { registrarAviso, registrarError } from '@/lib/observabilidad'

/**
 * ¿Esta respuesta sale en voz, y con qué audio?
 *
 * La lógica ya existía dentro de `/api/agent/voice/reply`, pero ningún nodo del workflow
 * llamaba a esa ruta: el agente era solo texto. Se saca acá para que la use también
 * `/api/agent/reply`, que es por donde salen TODAS las respuestas, y así la voz deja de
 * depender de que alguien acuerde conectar un nodo.
 *
 * Nunca deja al agente mudo: cualquier problema devuelve `speak: false` y el texto se manda
 * igual. Y nunca habla en modo equipo.
 */

const ESPERADOS = new Set(['voz_desactivada', 'solo_si_hablo_por_voz', 'modo_equipo_solo_texto', 'datos_incompletos'])

export type VozDeRespuesta = {
  speak: boolean
  sendText: boolean
  audio?: string
  mime?: string
  chars?: number
  reason?: string
}

export async function vozParaRespuesta(
  db: SupabaseClient,
  datos: { businessId: string; text: string; wasAudio?: boolean; actorType?: string },
): Promise<VozDeRespuesta> {
  const soloTexto = (reason: string): VozDeRespuesta => {
    if (!ESPERADOS.has(reason)) registrarAviso('agent_voz_sin_audio', { businessId: datos.businessId, motivo: reason })
    return { speak: false, sendText: true, reason }
  }

  try {
    const texto = String(datos.text || '').trim()
    if (!datos.businessId || !texto) return soloTexto('datos_incompletos')
    if (datos.actorType === 'TEAM') return soloTexto('modo_equipo_solo_texto')

    const { data: business } = await db.from('businesses')
      .select('agent_settings,dashscope_api_key,dashscope_endpoint').eq('id', datos.businessId).maybeSingle()
    if (!business) return soloTexto('negocio_inexistente')

    const settings = (business.agent_settings ?? {}) as { voice?: Record<string, unknown>; behavior?: Record<string, unknown> }
    const voice = settings.voice ?? {}
    const behavior = settings.behavior ?? {}
    if (!voice.enabled || !behavior.respond_voice) return soloTexto('voz_desactivada')
    if (behavior.respond_voice_only_if_voice !== false && !datos.wasAudio) return soloTexto('solo_si_hablo_por_voz')

    const maxSeconds = Number(behavior.max_duration_seconds ?? 30)
    const maxChars = Math.max(60, Math.round(maxSeconds * 14))
    if (texto.length > maxChars) return soloTexto('texto_demasiado_largo')

    const { key, endpoint } = await resolveDashScopeKey(business.dashscope_api_key, business.dashscope_endpoint)
    if (!key) return soloTexto('sin_clave_voz')

    const audio = await generateSpeech(texto, voice, key, endpoint)
    return { speak: true, sendText: behavior.also_send_text !== false, audio: audio.audioBase64, mime: audio.mime, chars: audio.chars }
  } catch (error) {
    registrarError('agent_voz_excepcion', { businessId: datos.businessId, error })
    return soloTexto('error_generando_voz')
  }
}
