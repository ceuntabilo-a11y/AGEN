type Business = { id: string; whatsapp_provider: string | null; whatsapp_instance: string | null; whatsapp_phone_id: string | null; whatsapp_token: string | null; whatsapp_360_api_key: string | null }

function evolutionUrl() { return process.env.EVOLUTION_API_URL }
function evolutionKey() { return process.env.EVOLUTION_API_KEY || '' }

async function evolutionFetch(path: string, options?: { method?: string; body?: unknown }) {
  const base = evolutionUrl()
  if (!base) throw new Error('EVOLUTION_API_URL no configurado')
  const response = await fetch(`${base}${path}`, {
    method: options?.method ?? 'GET',
    headers: { apikey: evolutionKey(), 'content-type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: response.ok, status: response.status, data }
}

export async function evolutionConnectionState(instance: string) {
  const result = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instance)}`)
  return result.data?.instance?.state ?? 'close'
}

export async function connectEvolutionInstance(instance: string) {
  const state = await evolutionConnectionState(instance)
  if (state === 'open') return { instance, state, qr: null }
  const created = await evolutionFetch('/instance/create', { method: 'POST', body: { instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true } })
  if (created.ok && created.data?.qrcode?.base64) return { instance, state: 'connecting', qr: created.data.qrcode.base64 as string }
  const conn = await evolutionFetch(`/instance/connect/${encodeURIComponent(instance)}`)
  return { instance, state: 'connecting', qr: (conn.data?.base64 ?? conn.data?.qrcode?.base64 ?? null) as string | null }
}

export async function disconnectEvolutionInstance(instance: string) {
  await evolutionFetch(`/instance/logout/${encodeURIComponent(instance)}`, { method: 'DELETE' })
  await evolutionFetch(`/instance/delete/${encodeURIComponent(instance)}`, { method: 'DELETE' })
}

export async function sendWhatsApp(business: Business, params: { phone: string; text: string; imageUrl?: string | null }): Promise<{ success: boolean; error?: string }> {
  const provider = business.whatsapp_provider
  try {
    if (provider === 'EVOLUTION') {
      if (!business.whatsapp_instance) return { success: false, error: 'sin_instancia_evolution' }
      const inst = encodeURIComponent(business.whatsapp_instance)
      const result = params.imageUrl
        ? await evolutionFetch(`/message/sendMedia/${inst}`, { method: 'POST', body: { number: params.phone, mediatype: 'image', media: params.imageUrl, caption: params.text } })
        : await evolutionFetch(`/message/sendText/${inst}`, { method: 'POST', body: { number: params.phone, text: params.text } })
      return { success: result.ok, error: result.ok ? undefined : `evolution_${result.status}` }
    }
    if (provider === 'META') {
      if (!business.whatsapp_phone_id || !business.whatsapp_token) return { success: false, error: 'sin_credenciales_meta' }
      const payload = params.imageUrl
        ? { messaging_product: 'whatsapp', to: params.phone, type: 'image', image: { link: params.imageUrl, caption: params.text } }
        : { messaging_product: 'whatsapp', to: params.phone, type: 'text', text: { body: params.text } }
      const response = await fetch(`https://graph.facebook.com/v21.0/${business.whatsapp_phone_id}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${business.whatsapp_token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      })
      return { success: response.ok, error: response.ok ? undefined : `meta_${response.status}` }
    }
    if (provider === 'DIALOG360') {
      if (!business.whatsapp_360_api_key) return { success: false, error: 'sin_credenciales_360dialog' }
      const payload = params.imageUrl
        ? { to: params.phone, type: 'image', image: { link: params.imageUrl, caption: params.text } }
        : { to: params.phone, type: 'text', text: { body: params.text } }
      const response = await fetch('https://waba.360dialog.io/v1/messages', {
        method: 'POST', headers: { 'D360-API-KEY': business.whatsapp_360_api_key, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      })
      return { success: response.ok, error: response.ok ? undefined : `dialog360_${response.status}` }
    }
    return { success: false, error: 'sin_proveedor_configurado' }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : 'error_envio' } }
}
