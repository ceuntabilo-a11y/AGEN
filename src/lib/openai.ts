import { createAdminClient } from '@/lib/supabase-admin'

export async function resolveOpenAiKey(businessOwnKey: string | null | undefined) {
  if (businessOwnKey?.trim()) return { key: businessOwnKey.trim(), ownKey: true }
  const db = createAdminClient()
  const { data } = await db.from('platform_settings').select('value').eq('key', 'openai_fallback_key').maybeSingle()
  const fallback = typeof data?.value === 'string' ? data.value : null
  return { key: fallback || process.env.OPENAI_API_KEY || null, ownKey: false }
}

export async function resolveDashScopeKey(businessOwnKey: string | null | undefined, businessOwnEndpoint: string | null | undefined) {
  if (businessOwnKey?.trim()) return { key: businessOwnKey.trim(), endpoint: businessOwnEndpoint?.trim() || null }
  const db = createAdminClient()
  const { data } = await db.from('platform_settings').select('key,value').in('key', ['dashscope_fallback_key', 'dashscope_fallback_endpoint'])
  const key = data?.find(row => row.key === 'dashscope_fallback_key')?.value
  const endpoint = data?.find(row => row.key === 'dashscope_fallback_endpoint')?.value
  return { key: (typeof key === 'string' ? key : null), endpoint: (typeof endpoint === 'string' ? endpoint : null) }
}

export async function chatCompletion(apiKey: string, messages: { role: 'system' | 'user'; content: string }[], options?: { model?: string; maxTokens?: number; temperature?: number; json?: boolean }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: options?.model ?? 'gpt-4o-mini', messages, max_tokens: options?.maxTokens ?? 400, temperature: options?.temperature ?? 0.3,
      ...(options?.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`OPENAI_${response.status}`)
  const data = await response.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('OPENAI_EMPTY')
  return content
}

/** Genera una imagen desde un texto. Devuelve un `data:` URI listo para usar en el navegador. */
export async function generateImage(apiKey: string, prompt: string, options?: { size?: '1024x1024' | '1536x1024' | '1024x1536' }) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: options?.size ?? '1024x1024', n: 1 }),
    signal: AbortSignal.timeout(60000),
  })
  if (!response.ok) throw new Error(`OPENAI_IMG_${response.status}`)
  const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
  const item = data.data?.[0]
  if (!item) throw new Error('OPENAI_IMG_EMPTY')
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item.url) {
    const descargada = await fetch(item.url)
    const buffer = Buffer.from(await descargada.arrayBuffer())
    return `data:image/png;base64,${buffer.toString('base64')}`
  }
  throw new Error('OPENAI_IMG_EMPTY')
}
