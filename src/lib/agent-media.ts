import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveOpenAiKey } from '@/lib/openai'
import { registrarAviso, registrarError } from '@/lib/observabilidad'

/**
 * Lo que el cliente manda que no es texto, y lo que el negocio le puede mandar de vuelta.
 *
 * Estaba construido y desconectado: `/api/agent/media` existía desde hace meses y ningún nodo
 * del workflow lo llamaba, así que el agente era solo texto. Acá vive la lógica para que la
 * use tanto esa ruta como el router (`/api/agent/turn`), sin dos copias.
 *
 * Regla de oro: nada de esto puede tumbar un turno. Si la capacidad está apagada, no hay clave
 * o el proveedor falla, se devuelve `texto: null` y la conversación sigue como si el cliente
 * hubiera escrito solo texto.
 */

export type MediaDescrita = {
  tipo: 'imagen' | 'audio' | null
  texto: string | null
  pareceComprobante: boolean
  /** Por qué no hay texto. `desactivada` es una decisión del negocio, no un fallo. */
  motivo: 'ok' | 'sin_media' | 'desactivada' | 'sin_clave' | 'fallo'
}

const VACIO: MediaDescrita = { tipo: null, texto: null, pareceComprobante: false, motivo: 'sin_media' }

/** Señales de que la imagen es un comprobante de pago y no una foto de un trabajo. */
const COMPROBANTE = /\b(comprobante|transferencia|transferi|dep[oó]sito|dep[oó]sit|pago|pagu[eé]|abono|monto|banco|bancaria|cuenta corriente|rut|boleta|factura|voucher|recibo)\b/i

export async function describirMedia(
  db: SupabaseClient,
  datos: { businessId: string; mediaType: 'image' | 'audio' | null; mediaUrl: string | null },
): Promise<MediaDescrita> {
  if (!datos.mediaType || !datos.mediaUrl) return VACIO

  try {
    const { data: business } = await db.from('businesses')
      .select('feature_image,feature_voice,openai_api_key').eq('id', datos.businessId).maybeSingle()
    if (!business) return VACIO
    if (datos.mediaType === 'image' && !business.feature_image) return { ...VACIO, tipo: 'imagen', motivo: 'desactivada' }
    if (datos.mediaType === 'audio' && !business.feature_voice) return { ...VACIO, tipo: 'audio', motivo: 'desactivada' }

    const { key } = await resolveOpenAiKey(business.openai_api_key)
    if (!key) {
      registrarAviso('agent_media_sin_clave', { businessId: datos.businessId, mediaType: datos.mediaType })
      return { ...VACIO, tipo: datos.mediaType === 'audio' ? 'audio' : 'imagen', motivo: 'sin_clave' }
    }

    if (datos.mediaType === 'audio') {
      const audio = await fetch(datos.mediaUrl, { signal: AbortSignal.timeout(15000) })
      if (!audio.ok) {
        registrarAviso('agent_media_descarga_fallida', { businessId: datos.businessId, mediaType: 'audio', httpEstado: audio.status })
        return { ...VACIO, tipo: 'audio', motivo: 'fallo' }
      }
      const form = new FormData()
      form.append('file', await audio.blob(), 'audio.ogg')
      form.append('model', 'whisper-1')
      const transcripcion = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(20000),
      })
      if (!transcripcion.ok) {
        registrarError('agent_media_whisper_fallo', { businessId: datos.businessId, httpEstado: transcripcion.status })
        return { ...VACIO, tipo: 'audio', motivo: 'fallo' }
      }
      const cuerpo = await transcripcion.json() as { text?: string }
      return { tipo: 'audio', texto: cuerpo.text?.trim() || null, pareceComprobante: false, motivo: 'ok' }
    }

    const vision = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 220,
        messages: [{ role: 'user', content: [
          { type: 'text', text: 'Describe en una o dos frases esta imagen que un cliente envió por WhatsApp a un negocio de servicios (peluquería, estética). Si es un comprobante de pago, empieza con la palabra COMPROBANTE y extrae monto y fecha si se ven. Si es la foto de un trabajo (uñas, corte, color, maquillaje), descríbelo en pocas palabras. Responde en español.' },
          { type: 'image_url', image_url: { url: datos.mediaUrl } },
        ] }],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!vision.ok) {
      registrarError('agent_media_vision_fallo', { businessId: datos.businessId, httpEstado: vision.status })
      return { ...VACIO, tipo: 'imagen', motivo: 'fallo' }
    }
    const cuerpo = await vision.json() as { choices?: { message?: { content?: string } }[] }
    const texto = cuerpo.choices?.[0]?.message?.content?.trim() || null
    return { tipo: 'imagen', texto, pareceComprobante: Boolean(texto && COMPROBANTE.test(texto)), motivo: 'ok' }
  } catch (error) {
    registrarError('agent_media_excepcion', { businessId: datos.businessId, mediaType: datos.mediaType, error })
    return { ...VACIO, tipo: datos.mediaType === 'audio' ? 'audio' : 'imagen', motivo: 'fallo' }
  }
}

/**
 * Fotos reales de trabajos del negocio para responder a una foto del cliente.
 *
 * Solo se ofrecen las publicadas y con consentimiento del cliente de la foto (`published` y
 * `client_consent`, que ya lo exige la propia tabla). La elección la hace esta consulta y no
 * el modelo: así es imposible que el agente enseñe un trabajo que no existe.
 */
export async function fotosDelPortafolio(
  db: SupabaseClient,
  datos: { businessId: string; texto: string; professionalId?: string | null; limite?: number },
): Promise<string[]> {
  try {
    let consulta = db.from('portfolio_items')
      .select('after_url,title,description,professional_id,service:services(name)')
      .eq('business_id', datos.businessId)
      .eq('published', true)
      .eq('client_consent', true)
      .order('created_at', { ascending: false })
      .limit(20)
    if (datos.professionalId) consulta = consulta.eq('professional_id', datos.professionalId)

    const { data, error } = await consulta
    if (error || !data?.length) return []

    const palabras = String(datos.texto ?? '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter((palabra) => palabra.length >= 4)

    const puntuar = (fila: Record<string, any>) => {
      const servicio = Array.isArray(fila.service) ? fila.service[0] : fila.service
      const texto = `${fila.title ?? ''} ${fila.description ?? ''} ${servicio?.name ?? ''}`
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      return palabras.reduce((total, palabra) => total + (texto.includes(palabra) ? 1 : 0), 0)
    }

    return (data as Array<Record<string, any>>)
      .map((fila) => ({ url: String(fila.after_url ?? ''), puntos: puntuar(fila) }))
      .filter((item) => /^https?:\/\//i.test(item.url))
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, datos.limite ?? 1)
      .map((item) => item.url)
  } catch {
    return []
  }
}
