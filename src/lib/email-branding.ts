function escapar(texto: string) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * La cabecera con la que un correo se identifica: el logo del negocio, o su nombre en negrita
 * si todavía no subió uno. Ya existía este mismo patrón en `quote-document.ts`; acá se comparte
 * para las campañas de marketing y los avisos automáticos (recordatorios, confirmaciones…), que
 * hasta ahora salían sin ninguna identidad visual.
 */
export function cabeceraDeCorreo(business: { name: string; logo_url?: string | null }, color = '#5b3df5') {
  return business.logo_url
    ? `<img src="${escapar(business.logo_url)}" alt="${escapar(business.name)}" style="height:40px;max-width:160px;object-fit:contain;margin-bottom:16px"/>`
    : `<p style="font-weight:800;font-size:18px;margin:0 0 16px;color:${escapar(color)}">${escapar(business.name)}</p>`
}
