import { createAdminClient } from '@/lib/supabase-admin'

async function resolveResendCredentials() {
  const db = createAdminClient()
  const { data } = await db.from('platform_settings').select('key,value').in('key', ['resend_api_key', 'resend_from'])
  const key = data?.find(row => row.key === 'resend_api_key')?.value
  const from = data?.find(row => row.key === 'resend_from')?.value
  return {
    key: (typeof key === 'string' && key) || process.env.RESEND_API_KEY || '',
    from: (typeof from === 'string' && from) || process.env.RESEND_FROM || 'Agen <notificaciones@agen.synetia.site>',
  }
}

export async function resendConfigured() {
  const { key } = await resolveResendCredentials()
  return Boolean(key)
}

export async function sendMarketingEmail(params: { to: string; subject: string; html: string; businessName: string; replyTo?: string | null }): Promise<{ success: boolean; error?: string }> {
  const { key, from } = await resolveResendCredentials()
  if (!key) return { success: false, error: 'resend_no_configurado' }
  const fromName = `${params.businessName} <${from.replace(/^.*<([^>]+)>.*$/, '$1')}>`
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: fromName, to: [params.to], subject: params.subject, html: params.html, reply_to: params.replyTo || undefined }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return { success: false, error: `resend_${response.status}` }
    return { success: true }
  } catch {
    return { success: false, error: 'resend_error_red' }
  }
}
