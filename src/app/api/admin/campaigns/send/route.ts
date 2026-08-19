import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { resolveCampaignAudience } from '@/lib/campaign-audience'
import { sendWhatsApp } from '@/lib/whatsapp'
import { sendMarketingEmail, resendConfigured } from '@/lib/resend'
import {
  claimCampaignForSending, destinatariosYaEnviados, destinatariosYaEnviadosPorCanal, destinatarioKey,
  faltaColumna, markCampaignSent, restoreCampaignStatus, type MotivoNoEnviable,
} from '@/lib/campaigns'
import { createAdminClient } from '@/lib/supabase-admin'
import { ESPERA_DE_CAMPANA, registrarAvisoSaliente } from '@/lib/outbound-context'
import { cabeceraDeCorreo } from '@/lib/email-branding'

const MOTIVOS: Record<MotivoNoEnviable, string> = {
  inexistente: 'La campaña no existe',
  ya_enviada: 'Esta campaña ya se envió. Duplícala si quieres volver a mandarla.',
  en_proceso: 'La campaña ya está en proceso',
  no_enviable: 'La campaña no está en un estado que se pueda enviar',
  fallo: 'No se pudo preparar el envío',
}

function emailHtml(business: { name: string; logo_url?: string | null }, content: string, unsubscribeUrl: string) {
  const body = content.split('\n').map((line) => `<p style="margin:0 0 12px">${line}</p>`).join('')
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px">
    ${cabeceraDeCorreo(business)}
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px" />
    <p style="font-size:12px;color:#888;margin:0">
      Recibiste este correo porque tienes una cuenta con ${business.name}.
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

    /**
     * Una campaña también es un mensaje que el negocio manda solo, y la gente le contesta.
     * Se registra con service_role a propósito: el agente lee esa tabla para interpretar
     * respuestas, así que nadie que no sea el sistema debería poder escribir en ella.
     */
    const sistema = createAdminClient()
    const registrarEnvio = (clientId: string, channel: 'WHATSAPP' | 'EMAIL') => registrarAvisoSaliente(sistema, {
      businessId, clientId, channel, kind: 'CAMPAIGN', campaignId,
      espera: ESPERA_DE_CAMPANA,
      summary: `campaña "${campaign.name}"`,
    })

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
            if (result.success) await registrarEnvio(client.id, 'WHATSAPP')
          }
          await markCampaignSent(db, campaignId)
          return NextResponse.json({ sent: true, recipients: pendientes.length, skipped: eligible.length - pendientes.length })
        }
      }

      if (campaign.channel === 'EMAIL') {
        if (!(await resendConfigured())) return devolver(NextResponse.json({ error: 'El correo de marketing no está configurado (falta la clave de Resend en Plataforma → Claves).' }, { status: 503 }))
        const { data: business } = await db.from('businesses').select('name,email,logo_url').eq('id', businessId).single()
        const businessName = business?.name ?? 'Agen'
        const { eligible } = await resolveCampaignAudience(db, businessId, campaign)
        const yaEnviados = await destinatariosYaEnviados(db, campaignId)
        const pendientes = eligible.filter((client) => !yaEnviados.has(client.id))
        // ignoreDuplicates: reanudar no puede devolver a PENDING una fila que ya salió.
        await db.from('campaign_recipients').upsert(pendientes.map((client) => ({ campaign_id: campaignId, client_id: client.id, status: 'PENDING', reason: null, sent_at: null })), { onConflict: 'campaign_id,client_id', ignoreDuplicates: true })
        for (const client of pendientes) {
          const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${client.marketing_unsubscribe_token ?? ''}`
          const result = await sendMarketingEmail({ to: client.email!, subject: (campaign.subject?.trim() || campaign.name), html: campaign.email_html ? campaign.email_html.replace(/{{unsubscribeUrl}}/g, unsubscribeUrl) : emailHtml({ name: businessName, logo_url: business?.logo_url }, campaign.content, unsubscribeUrl), businessName, replyTo: business?.email })
          await db.from('campaign_recipients').update({ status: result.success ? 'SENT' : 'FAILED', reason: result.error ?? null, sent_at: result.success ? new Date().toISOString() : null }).eq('campaign_id', campaignId).eq('client_id', client.id)
          if (result.success) await registrarEnvio(client.id, 'EMAIL')
        }
        await markCampaignSent(db, campaignId)
        return NextResponse.json({ sent: true, recipients: pendientes.length, skipped: eligible.length - pendientes.length })
      }

      if (campaign.channel === 'BOTH') {
        // La columna `channel` de `campaign_recipients` es la que distingue el WhatsApp del
        // correo del mismo cliente dentro de esta campaña; sin la migración aplicada no hay
        // dónde guardar esa diferencia, así que se avisa en vez de mezclar los dos envíos.
        // Un UPDATE que no matchea ninguna fila real (mismo truco que `sending_since` en
        // `claimCampaignForSending`) valida la columna sin tocar nada.
        const prueba = await db.from('campaign_recipients').update({ channel: null }).eq('campaign_id', '00000000-0000-0000-0000-000000000000')
        if (faltaColumna(prueba.error)) {
          return devolver(NextResponse.json({ error: 'Falta aplicar la migración 20260819000001 antes de enviar por los dos canales a la vez.' }, { status: 503 }))
        }
        const { data: business } = await db.from('businesses').select('name,email,logo_url,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key').eq('id', businessId).single()
        if (!business) return devolver(NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 }))
        const businessName = business.name ?? 'Agen'
        const correoDisponible = await resendConfigured()
        const { eligible } = await resolveCampaignAudience(db, businessId, campaign)
        const yaEnviados = await destinatariosYaEnviadosPorCanal(db, campaignId)
        const pendientes = eligible.flatMap((client) => client.channels
          .filter((canal) => canal !== 'EMAIL' || correoDisponible)
          .filter((canal) => canal !== 'WHATSAPP' || Boolean(business.whatsapp_provider))
          .filter((canal) => !yaEnviados.has(destinatarioKey(client.id, canal)))
          .map((canal) => ({ client, canal })))
        await db.from('campaign_recipients').upsert(
          pendientes.map(({ client, canal }) => ({ campaign_id: campaignId, client_id: client.id, channel: canal, status: 'PENDING', reason: null, sent_at: null })),
          { onConflict: 'campaign_id,client_id,channel', ignoreDuplicates: true },
        )
        let enviados = 0
        for (const { client, canal } of pendientes) {
          const result = canal === 'WHATSAPP'
            ? await sendWhatsApp({ id: businessId, whatsapp_provider: business.whatsapp_provider, whatsapp_instance: business.whatsapp_instance, whatsapp_phone_id: business.whatsapp_phone_id, whatsapp_token: business.whatsapp_token, whatsapp_360_api_key: business.whatsapp_360_api_key }, { phone: client.phone!, text: campaign.content, imageUrl: campaign.image_url })
            : await sendMarketingEmail({ to: client.email!, subject: (campaign.subject?.trim() || campaign.name), html: campaign.email_html ? campaign.email_html.replace(/{{unsubscribeUrl}}/g, `${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${client.marketing_unsubscribe_token ?? ''}`) : emailHtml({ name: businessName, logo_url: business.logo_url }, campaign.content, `${process.env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${client.marketing_unsubscribe_token ?? ''}`), businessName, replyTo: business.email })
          await db.from('campaign_recipients').update({ status: result.success ? 'SENT' : 'FAILED', reason: result.error ?? null, sent_at: result.success ? new Date().toISOString() : null }).eq('campaign_id', campaignId).eq('client_id', client.id).eq('channel', canal)
          if (result.success) { enviados += 1; await registrarEnvio(client.id, canal) }
        }
        await markCampaignSent(db, campaignId)
        return NextResponse.json({ sent: true, recipients: enviados, skipped: pendientes.length - enviados })
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
