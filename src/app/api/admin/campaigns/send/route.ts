import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resolveCampaignAudience } from '@/lib/campaign-audience'
import { sendWhatsApp } from '@/lib/whatsapp'
import { sendMarketingEmail, resendConfigured } from '@/lib/resend'

function emailHtml(businessName: string, content: string, unsubscribeUrl: string) {
  const body = content.split('\n').map((line) => `<p style="margin:0 0 12px">${line}</p>`).join('')
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
    <p style="font-weight:800;font-size:18px;margin:0 0 20px">${businessName}</p>
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px" />
    <p style="font-size:12px;color:#888;margin:0">
      Recibiste este correo porque tienes una cuenta con ${businessName}.
      <a href="${unsubscribeUrl}" style="color:#888">Dejar de recibir promociones</a>
    </p>
  </div>`
}

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { campaignId } = await request.json() as { campaignId?: string }
    if (!campaignId) return NextResponse.json({ error: 'campaignId es obligatorio' }, { status: 400 })
    const { data: campaign, error } = await db.from('campaigns').select('*').eq('id', campaignId).eq('business_id', businessId).single()
    if (error) throw error
    if (campaign.status === 'SENDING') return NextResponse.json({ error: 'La campaña ya está en proceso' }, { status: 409 })

    if (campaign.channel === 'WHATSAPP') {
      const { data: business } = await db.from('businesses').select('whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key').eq('id', businessId).single()
      if (business?.whatsapp_provider) {
        await db.from('campaigns').update({ status: 'SENDING' }).eq('id', campaignId)
        const { eligible } = await resolveCampaignAudience(db, businessId, campaign)
        await db.from('campaign_recipients').upsert(eligible.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING', reason: null, sent_at: null })), { onConflict: 'campaign_id,client_id' })
        for (const client of eligible) {
          const result = await sendWhatsApp({ id: businessId, whatsapp_provider: business.whatsapp_provider, whatsapp_instance: business.whatsapp_instance, whatsapp_phone_id: business.whatsapp_phone_id, whatsapp_token: business.whatsapp_token, whatsapp_360_api_key: business.whatsapp_360_api_key }, { phone: client.phone!, text: campaign.content, imageUrl: campaign.image_url })
          await db.from('campaign_recipients').update({ status: result.success ? 'SENT' : 'FAILED', reason: result.error ?? null, sent_at: result.success ? new Date().toISOString() : null }).eq('campaign_id', campaignId).eq('client_id', client.id)
        }
        await db.from('campaigns').update({ status: 'SENT', sent_at: new Date().toISOString() }).eq('id', campaignId)
        return NextResponse.json({ sent: true, recipients: eligible.length })
      }
    }

    if (campaign.channel === 'EMAIL') {
      if (!(await resendConfigured())) return NextResponse.json({ error: 'El correo de marketing no está configurado (falta la clave de Resend en Plataforma → Claves).' }, { status: 503 })
      const { data: business } = await db.from('businesses').select('name,email').eq('id', businessId).single()
      const businessName = business?.name ?? 'Agen'
      await db.from('campaigns').update({ status: 'SENDING' }).eq('id', campaignId)
      const { eligible } = await resolveCampaignAudience(db, businessId, campaign)
      await db.from('campaign_recipients').upsert(eligible.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING', reason: null, sent_at: null })), { onConflict: 'campaign_id,client_id' })
      for (const client of eligible) {
        const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${client.marketing_unsubscribe_token ?? ''}`
        const result = await sendMarketingEmail({ to: client.email!, subject: (campaign.subject?.trim() || campaign.name), html: campaign.email_html ? campaign.email_html.replace(/{{unsubscribeUrl}}/g, unsubscribeUrl) : emailHtml(businessName, campaign.content, unsubscribeUrl), businessName, replyTo: business?.email })
        await db.from('campaign_recipients').update({ status: result.success ? 'SENT' : 'FAILED', reason: result.error ?? null, sent_at: result.success ? new Date().toISOString() : null }).eq('campaign_id', campaignId).eq('client_id', client.id)
      }
      await db.from('campaigns').update({ status: 'SENT', sent_at: new Date().toISOString() }).eq('id', campaignId)
      return NextResponse.json({ sent: true, recipients: eligible.length })
    }

    const webhook = process.env.N8N_WEBHOOK_URL, secret = process.env.N8N_WEBHOOK_SECRET
    if (!webhook || !secret) return NextResponse.json({ error: 'n8n no está configurado' }, { status: 503 })
    await db.from('campaigns').update({ status: 'SENDING' }).eq('id', campaignId)
    const response = await fetch(`${webhook.replace(/\/$/, '')}/agen-campaign`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agen-secret': secret }, body: JSON.stringify({ businessId, campaignId }) })
    if (!response.ok) { await db.from('campaigns').update({ status: 'DRAFT' }).eq('id', campaignId); return NextResponse.json({ error: 'n8n rechazó la campaña' }, { status: 502 }) }
    return NextResponse.json({ queued: true })
  } catch (error) { return apiError(error) }
}
