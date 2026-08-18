import { money } from '@/lib/money'
import { formatInZone } from '@/lib/timezone'

/**
 * El presupuesto como documento, escrito una sola vez.
 *
 * Antes no existía: los presupuestos aparecían en una lista con el total y nada más, sin forma
 * de verlos, imprimirlos ni mandárselos al cliente. Se escribe acá —y no dentro de la pantalla—
 * porque el MISMO documento tiene que salir en tres sitios y decir exactamente lo mismo: en
 * pantalla, en el correo y en el WhatsApp.
 *
 * Lleva la identidad del negocio (logo y color) porque un presupuesto es lo que el cliente
 * guarda, reenvía y compara con el de al lado.
 */

export type NegocioDelDocumento = {
  name: string
  logo_url?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  currency?: string | null
  timezone?: string | null
  settings?: { brand_color?: string | null } | null
}

export type PresupuestoParaDocumento = {
  id: string
  status: string
  subtotal?: number | null
  discount?: number | null
  tax?: number | null
  total?: number | null
  valid_until?: string | null
  notes?: string | null
  created_at?: string | null
  client?: { full_name?: string | null; phone?: string | null; email?: string | null } | null
  professional?: { display_name?: string | null } | null
  quote_items?: Array<{ description?: string | null; quantity?: number | null; unit_price?: number | null; line_total?: number | null }> | null
}

export const ESTADO_EN_PALABRAS: Record<string, string> = {
  DRAFT: 'Borrador', SENT: 'Enviado', ACCEPTED: 'Aceptado',
  REJECTED: 'Rechazado', EXPIRED: 'Vencido', CONVERTED: 'Convertido',
}

/** Número corto y estable para que el cliente pueda referirse a él. */
export function numeroDePresupuesto(id: string): string {
  return `#${String(id).replace(/-/g, '').slice(0, 6).toUpperCase()}`
}

function fecha(valor: string | null | undefined, timezone: string) {
  if (!valor) return null
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T12:00:00Z` : valor
  return formatInZone(soloFecha, timezone, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** El presupuesto en texto plano, que es lo que se manda por WhatsApp. */
export function presupuestoComoTexto(negocio: NegocioDelDocumento, quote: PresupuestoParaDocumento): string {
  const moneda = negocio.currency || 'CLP'
  const zona = negocio.timezone || 'America/Santiago'
  const lineas = (quote.quote_items ?? []).map((item) => {
    const cantidad = Number(item.quantity ?? 1)
    const detalle = cantidad > 1 ? `${item.description} ×${cantidad}` : String(item.description ?? '')
    return `• ${detalle} — ${money(Number(item.line_total ?? 0), moneda)}`
  })

  const partes = [
    `*Presupuesto ${numeroDePresupuesto(quote.id)}* · ${negocio.name}`,
    '',
    quote.client?.full_name ? `Para: ${quote.client.full_name}` : null,
    quote.professional?.display_name ? `Atiende: ${quote.professional.display_name}` : null,
    '',
    ...lineas,
    '',
    Number(quote.discount ?? 0) > 0 ? `Descuento: −${money(Number(quote.discount), moneda)}` : null,
    Number(quote.tax ?? 0) > 0 ? `Impuestos: ${money(Number(quote.tax), moneda)}` : null,
    `*Total: ${money(Number(quote.total ?? 0), moneda)}*`,
    quote.valid_until ? `Válido hasta el ${fecha(quote.valid_until, zona)}` : null,
    '',
    quote.notes ? quote.notes.trim() : null,
    negocio.address ? `📍 ${negocio.address}` : null,
    negocio.phone ? `📞 ${negocio.phone}` : null,
  ]

  return partes.filter((linea) => linea !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** El mismo presupuesto en HTML, que es lo que se manda por correo y lo que se imprime. */
export function presupuestoComoHtml(negocio: NegocioDelDocumento, quote: PresupuestoParaDocumento): string {
  const moneda = negocio.currency || 'CLP'
  const zona = negocio.timezone || 'America/Santiago'
  const color = negocio.settings?.brand_color || '#5b3df5'
  const escapar = (valor: unknown) => String(valor ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const filas = (quote.quote_items ?? []).map((item) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee">${escapar(item.description)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center;color:#736f83">${Number(item.quantity ?? 1)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">${money(Number(item.line_total ?? 0), moneda)}</td>
    </tr>`).join('')

  const extra = (etiqueta: string, valor: number, signo = '') => valor > 0
    ? `<tr><td colspan="2" style="padding:6px 0;text-align:right;color:#736f83">${etiqueta}</td><td style="padding:6px 0;text-align:right">${signo}${money(valor, moneda)}</td></tr>`
    : ''

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#1c1b22">
  <div style="border-top:6px solid ${escapar(color)};border-radius:16px 16px 0 0;padding:24px 24px 0">
    <table style="width:100%"><tr>
      <td>${negocio.logo_url ? `<img src="${escapar(negocio.logo_url)}" alt="${escapar(negocio.name)}" style="height:56px;max-width:180px;object-fit:contain"/>` : `<b style="font-size:20px">${escapar(negocio.name)}</b>`}</td>
      <td style="text-align:right;vertical-align:top">
        <div style="font-size:13px;color:#736f83">Presupuesto</div>
        <div style="font-size:20px;font-weight:800;color:${escapar(color)}">${numeroDePresupuesto(quote.id)}</div>
        ${quote.created_at ? `<div style="font-size:12px;color:#736f83">${escapar(fecha(quote.created_at, zona))}</div>` : ''}
      </td>
    </tr></table>
  </div>

  <div style="padding:20px 24px">
    <table style="width:100%;font-size:14px">
      <tr>
        <td style="vertical-align:top">
          <div style="color:#736f83;font-size:12px">PARA</div>
          <b>${escapar(quote.client?.full_name ?? 'Cliente')}</b>
          ${quote.client?.phone ? `<div style="color:#736f83;font-size:13px">${escapar(quote.client.phone)}</div>` : ''}
        </td>
        <td style="vertical-align:top;text-align:right">
          <div style="color:#736f83;font-size:12px">DE</div>
          <b>${escapar(negocio.name)}</b>
          ${negocio.address ? `<div style="color:#736f83;font-size:13px">${escapar(negocio.address)}</div>` : ''}
          ${negocio.phone ? `<div style="color:#736f83;font-size:13px">${escapar(negocio.phone)}</div>` : ''}
        </td>
      </tr>
    </table>

    <table style="width:100%;margin-top:24px;border-collapse:collapse;font-size:14px">
      <thead><tr style="color:#736f83;font-size:12px;text-align:left">
        <th style="padding-bottom:8px">DETALLE</th>
        <th style="padding-bottom:8px;text-align:center">CANT.</th>
        <th style="padding-bottom:8px;text-align:right">IMPORTE</th>
      </tr></thead>
      <tbody>${filas}</tbody>
      <tfoot>
        ${extra('Descuento', Number(quote.discount ?? 0), '−')}
        ${extra('Impuestos', Number(quote.tax ?? 0))}
        <tr><td colspan="2" style="padding-top:14px;text-align:right;font-weight:800">Total</td>
        <td style="padding-top:14px;text-align:right;font-size:20px;font-weight:800;color:${escapar(color)}">${money(Number(quote.total ?? 0), moneda)}</td></tr>
      </tfoot>
    </table>

    ${quote.valid_until ? `<p style="margin-top:18px;font-size:13px;color:#736f83">Válido hasta el ${escapar(fecha(quote.valid_until, zona))}.</p>` : ''}
    ${quote.notes ? `<p style="margin-top:8px;font-size:14px;white-space:pre-wrap">${escapar(quote.notes)}</p>` : ''}
    ${quote.professional?.display_name ? `<p style="margin-top:18px;font-size:13px;color:#736f83">Te atenderá ${escapar(quote.professional.display_name)}.</p>` : ''}
  </div>
</div>`
}
