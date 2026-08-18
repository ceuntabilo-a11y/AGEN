import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'
import { resendConfigured, sendTransactionalEmail } from '@/lib/resend'
import { normalizePhone } from '@/lib/phone'
import { presupuestoComoHtml, presupuestoComoTexto, type PresupuestoParaDocumento } from '@/lib/quote-document'

export const dynamic = 'force-dynamic'

/**
 * Manda el presupuesto al cliente por WhatsApp, por correo o por los dos.
 *
 * Antes esto no existía: el presupuesto se creaba, aparecía en una lista y ahí moría. El dueño
 * tenía que copiarlo a mano en otro sitio para poder enviarlo.
 *
 * Dos decisiones que evitan mentiras:
 *
 * 1. **Solo se marca como ENVIADO si de verdad salió por algún canal.** Si los dos fallan, el
 *    estado no cambia y se dice cuál falló y por qué.
 * 2. **El texto y el HTML salen del mismo sitio** (`@/lib/quote-document`) que la vista en
 *    pantalla, así el cliente recibe exactamente lo que el dueño vio antes de mandarlo.
 */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const body = await request.json() as { id?: string; channel?: string }
    const canal = String(body.channel ?? 'BOTH').toUpperCase()
    if (!body.id) return NextResponse.json({ error: 'Falta el presupuesto' }, { status: 400 })
    if (!['WHATSAPP', 'EMAIL', 'BOTH'].includes(canal)) return NextResponse.json({ error: 'Canal inválido' }, { status: 400 })

    const [negocio, presupuesto] = await Promise.all([
      db.from('businesses').select('id,name,logo_url,address,phone,email,currency,timezone,settings').eq('id', businessId).single(),
      db.from('quotes')
        .select('id,status,subtotal,discount,tax,total,valid_until,notes,created_at,client:clients(id,full_name,phone,email),professional:professionals(display_name),quote_items(id,description,quantity,unit_price,line_total)')
        .eq('id', body.id).eq('business_id', businessId).maybeSingle(),
    ])
    if (negocio.error) throw negocio.error
    if (presupuesto.error) throw presupuesto.error
    if (!presupuesto.data) return NextResponse.json({ error: 'Ese presupuesto no pertenece al negocio' }, { status: 404 })

    const quote = presupuesto.data as unknown as PresupuestoParaDocumento
    const cliente = quote.client ?? null
    const telefono = normalizePhone(cliente?.phone)
    const correo = (cliente?.email ?? '').trim()

    const quiereWhatsApp = canal === 'WHATSAPP' || canal === 'BOTH'
    const quiereCorreo = canal === 'EMAIL' || canal === 'BOTH'

    // Antes de intentar nada: si no hay a dónde mandarlo, se dice claro y no se toca el estado.
    if (quiereWhatsApp && !telefono && !(quiereCorreo && correo)) {
      return NextResponse.json({ error: 'Ese cliente no tiene teléfono guardado' }, { status: 400 })
    }
    if (quiereCorreo && !correo && !(quiereWhatsApp && telefono)) {
      return NextResponse.json({ error: 'Ese cliente no tiene correo guardado' }, { status: 400 })
    }

    const resultados: Record<string, { ok: boolean; error?: string }> = {}

    if (quiereWhatsApp) {
      if (!telefono) resultados.whatsapp = { ok: false, error: 'sin_telefono' }
      else {
        // El envío usa el proveedor del negocio, que solo el servidor puede leer.
        const { data: proveedor } = await createAdminClient().from('businesses')
          .select('id,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key')
          .eq('id', businessId).maybeSingle()
        const envio = proveedor
          ? await sendWhatsApp(proveedor as never, { phone: telefono, text: presupuestoComoTexto(negocio.data, quote) })
          : { success: false, error: 'sin_proveedor_configurado' }
        resultados.whatsapp = { ok: envio.success, error: envio.error }
      }
    }

    if (quiereCorreo) {
      if (!correo) resultados.email = { ok: false, error: 'sin_correo' }
      else if (!(await resendConfigured())) resultados.email = { ok: false, error: 'correo_no_configurado' }
      else {
        // Un presupuesto es transaccional, no marketing: no lleva enlace de baja ni depende de
        // consentimientos publicitarios.
        const envio = await sendTransactionalEmail({
          to: correo,
          subject: `Tu presupuesto de ${negocio.data.name}`,
          html: presupuestoComoHtml(negocio.data, quote),
          replyTo: negocio.data.email,
        })
        resultados.email = { ok: envio.success, error: envio.error }
      }
    }

    const seEnvio = Object.values(resultados).some((item) => item.ok)

    // El estado solo avanza si de verdad salió. Marcar «enviado» sin haber enviado es la clase
    // de mentira que hace que alguien no vuelva a llamar a un cliente.
    if (seEnvio && ['DRAFT', 'SENT'].includes(String(quote.status))) {
      await db.from('quotes').update({ status: 'SENT' }).eq('id', quote.id).eq('business_id', businessId)
    }

    if (!seEnvio) {
      const detalle = Object.entries(resultados).map(([canalFallido, item]) => `${canalFallido}: ${item.error ?? 'falló'}`).join(' · ')
      return NextResponse.json({ sent: false, results: resultados, error: `No se pudo enviar (${detalle})` }, { status: 502 })
    }

    return NextResponse.json({ sent: true, results: resultados, status: seEnvio ? 'SENT' : quote.status })
  } catch (error) { return apiError(error) }
}
