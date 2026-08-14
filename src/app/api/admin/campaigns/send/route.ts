import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resolveCampaignAudience } from '@/lib/campaign-audience'
import { sendWhatsApp } from '@/lib/whatsapp'
import { sendMarketingEmail, resendConfigured } from '@/lib/resend'
import { claimCampaignForSending, destinatariosYaEnviados, markCampaignSent, restoreCampaignStatus, type MotivoNoEnviable } from '@/lib/campaigns'

const MOTIVOS: Record<MotivoNoEnviable, string> = {
  inexistente: 'La campaña no existe',
  ya_enviada: 'Esta campaña ya se envió. Duplícala si quieres volver a mandarla.',
  en_proceso: 'La campaña ya está en proceso',
  no_enviable: 'La campaña no está en un estado que se pueda enviar',
  fallo: 'No se pudo preparar el envío',
}

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
    const { campaignId, resume } = await request.json() as { campaignId?: string; resume?: boolean }
    if (!campaignId) return NextResponse.json({ error: 'campaignId es obligatorio' }, { status: 400 })

    // Un envío sale a toda la audiencia: se toma la campaña de forma exclusiva ANTES de
    // hacer nada. Si otra petición ya la tomó (doble clic) o la campaña ya se envió, acá
    // termina. Si después no se puede empezar, se la devuelve a su estado anterior.
    const reclamo = await claimCampaignForSending(db, { businessId, campaignId, reanudar: resume === true })
    if (!reclamo.claimed) return NextResponse.json({ error: MOTIVOS[reclamo.motivo] }, { status: reclamo.motivo === 'inexistente' ? 404 : reclamo.motivo === 'fallo' ? 500 : 409 })
    const campaign = reclamo.campaign
    const devolver = async (respuesta: NextResponse) => {
      await restoreCampaignStatus(db, campaignId, reclamo.estadoPrevio)
      return respuesta
    }

    try {
      if (campaign.channel === 'WHATSAPP') {
        const { data: business } = await db.from('businesses').select('whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key').eq('id', businessId).single()
        if (business?.whatsapp_provider) {
          const { eligible } = await resolveCampaignAudience(db, businessId, campaign)
          const yaEnviados = await destinatariosYaEnviados(db, campaignId)
          const pendientes = eligible.filter((client) => !yaEnviados.has(client.id))
          // ignoreDuplicates: reanudar no puede devolver a PENDING una fila que ya salió.
          await db.from('campaign_recipients').upsert(pendientes.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING', reason: null, sent_at: null })), { onConflict: 'campaign_id,client_id', ignoreDuplicates: true })
          for (const client of pendientes) {
            const result = await sendWhatsApp({ id: businessId, whatsapp_provider: business.whatsapp_provider, whatsapp_instance: business.whatsapp_instance, whatsapp_phone_id: business.whatsapp_phone_id, whatsapp_token: business.whatsapp_token, whatsapp_360_api_key: business.whatsapp_360_api_key }, { phone: client.phone!, text: campaign.content, imageUrl: campaign.image_url })
            await db.from('campaign_recipients').update({ status: result.success ? 'SENT' : 'FAILED', reason: result.error ?? null, sent_at: result.success ? new Date().toISOString() : null }).eq('campaign_id', campaignId).eq('client_id', client.id)
          }
          await markCampaignSent(db, campaignId)
          return NextResponse.json({ sent: true, recipients: pendientes.length, skipped: eligible.length - pendientes.length })
        }
      }

      if (campaign.channel === 'EMAIL') {
        if (!(await resendConfigured())) return devolver(NextResponse.json({ error: 'El correo de marketing no está configurado (falta la clave de Resend en Plataforma → Claves).' }, { status: 503 }))
        const { data: business } = await db.from('businesses').select('name,email').eq('id', businessId).single()
        const businessName = business?.name ?? 'Agen'
        const { eligible } = await resolveCampaignAudience(db, businessId, campaign)
        const yaEnviados = await destinatariosYaEnviados(db, campaignId)
        const pendientes = eligible.filter((client) => !yaEnviados.has(client.id))
        // ignoreDuplicates: reanudar no puede devolver a PENDING una fila que ya salió.
        await db.from('campaign_recipients').upsert(pendientes.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING', reason: null, sent_at: null })), { onConflict: 'campaign_id,client_id', ignoreDuplicates: true })
        for (const client of pendientes) {
          const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${client.marketing_unsubscribe_token ?? ''}`
          const result = await sendMarketingEmail({ to: client.email!, subject: (campaign.subject?.trim() || campaign.name), html: campaign.email_html ? campaign.email_html.replace(/{{unsubscribeUrl}}/g, unsubscribeUrl) : emailHtml(businessName, campaign.content, unsubscribeUrl), businessName, replyTo: business?.email })
          await db.from('campaign_recipients').update({ status: result.success ? 'SENT' : 'FAILED', reason: result.error ?? null, sent_at: result.success ? new Date().toISOString() : null }).eq('campaign_id', campaignId).eq('client_id', client.id)
        }
        await markCampaignSent(db, campaignId)
        return NextResponse.json({ sent: true, recipients: pendientes.length, skipped: eligible.length - pendientes.length })
      }

      const webhook = process.env.N8N_WEBHOOK_URL, secret = process.env.N8N_WEBHOOK_SECRET
      if (!webhook || !secret) return devolver(NextResponse.json({ error: 'n8n no está configurado' }, { status: 503 }))
      const response = await fetch(`${webhook.replace(/\/$/, '')}/agen-campaign`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agen-secret': secret }, body: JSON.stringify({ businessId, campaignId }) })
      if (!response.ok) return devolver(NextResponse.json({ error: 'n8n rechazó la campaña' }, { status: 502 }))
      return NextResponse.json({ queued: true })
    } catch (error) {
      // Si algo falla después de tomarla, la campaña no puede quedarse trabada en SENDING.
      await restoreCampaignStatus(db, campaignId, reclamo.estadoPrevio)
      throw error
    }
  } catch (error) { return apiError(error) }
}
