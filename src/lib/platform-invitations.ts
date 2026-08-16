import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAviso } from '@/lib/observabilidad'
import { resendConfigured, sendMarketingEmail } from '@/lib/resend'

/**
 * Invitación del dueño de un negocio: emitir el enlace, mandarlo y llevar su estado.
 *
 * La regla que manda sobre todo lo demás: **por correo nunca viaja una contraseña**. El enlace
 * lo emite Supabase (`generateLink`), caduca solo y solo sirve una vez para que la persona
 * ponga su propia clave. Acá no se guarda ni el enlace ni ningún secreto — solo si la
 * invitación está pendiente, aceptada o vencida, que es lo que el panel necesita mostrar.
 *
 * Y no se crean usuarios duplicados: si el correo ya existe en Supabase se reutiliza esa cuenta
 * y se le añade la pertenencia al negocio nuevo.
 */

/** Cuánto vale una invitación antes de tener que reenviarla. */
export const DIAS_DE_VIGENCIA = 7

export type EstadoInvitacion = 'PENDING' | 'ACCEPTED' | 'EXPIRED'

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://agen.synetia.site').replace(/\/+$/, '')

/**
 * El usuario del dueño y el enlace para que entre.
 *
 * Devuelve `enlace: null` cuando la cuenta ya existía: en ese caso no hay invitación que emitir
 * —la persona ya tiene su clave— y lo correcto es que entre por el login de siempre.
 */
export async function emitirAcceso(
  db: SupabaseClient,
  email: string,
): Promise<{ userId: string; enlace: string | null; yaExistia: boolean } | { error: string }> {
  const correo = email.trim().toLowerCase()
  const enlace = await db.auth.admin.generateLink({
    type: 'invite',
    email: correo,
    options: { redirectTo: `${appUrl()}/auth/callback` },
  })

  if (!enlace.error) {
    return { userId: enlace.data.user.id, enlace: enlace.data.properties.action_link, yaExistia: false }
  }

  // Ya registrado: se reutiliza. Crear otro usuario con el mismo correo es imposible en
  // Supabase y, si lo fuera, partiría en dos la identidad de la misma persona.
  const esDuplicado = enlace.error.code === 'email_exists' || /already/i.test(enlace.error.message)
  if (!esDuplicado) return { error: enlace.error.message }

  const existentes = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  const encontrado = (existentes.data?.users ?? []).find((usuario) => usuario.email?.toLowerCase() === correo)
  if (!encontrado) return { error: 'Ese correo ya está registrado y no se pudo vincular automáticamente.' }
  return { userId: encontrado.id, enlace: null, yaExistia: true }
}

/** El correo de bienvenida. Ver `plantillaInvitacion`. */
export async function enviarInvitacion(datos: {
  email: string
  negocio: string
  enlace: string
  diasDeVigencia?: number
}): Promise<{ enviado: boolean; motivo?: string }> {
  if (!(await resendConfigured())) return { enviado: false, motivo: 'sin_resend' }
  const asunto = `Te damos acceso a ${datos.negocio} en Agen`
  const resultado = await sendMarketingEmail({
    to: datos.email,
    subject: asunto,
    html: plantillaInvitacion({ ...datos, diasDeVigencia: datos.diasDeVigencia ?? DIAS_DE_VIGENCIA }),
    businessName: datos.negocio,
  })
  if (!resultado.success) {
    registrarAviso('plataforma_invitacion_no_enviada', { motivo: resultado.error })
    return { enviado: false, motivo: resultado.error }
  }
  return { enviado: true }
}

/** Escapa lo que viene de la base antes de meterlo en el HTML del correo. */
function escapar(texto: string) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * Plantilla del correo de invitación.
 *
 * Tablas y estilos en línea a propósito: es lo único que se ve igual en Gmail, Outlook y el
 * cliente de correo del móvil. Sin imágenes externas — el logo es una letra sobre color, así
 * que se ve aunque el cliente bloquee la carga de imágenes, que es lo normal en un primer
 * correo de alguien desconocido.
 */
export function plantillaInvitacion(datos: { negocio: string; enlace: string; diasDeVigencia: number }): string {
  const negocio = escapar(datos.negocio)
  const enlace = escapar(datos.enlace)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu acceso a Agen</title></head>
<body style="margin:0;padding:0;background:#f5f4f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(20,16,40,.08);">
  <tr><td style="background:#19162b;padding:28px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:44px;height:44px;background:#6c4cff;border-radius:14px;color:#ffffff;font-size:22px;font-weight:800;text-align:center;line-height:44px;">A</td>
      <td style="padding-left:12px;color:#ffffff;font-size:20px;font-weight:700;">Agen</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px;color:#19162b;">
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Te invitaron a administrar ${negocio}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4658;">
      Agen es la agenda con asistente por WhatsApp de <strong>${negocio}</strong>. Desde tu panel vas a
      gestionar las horas, el equipo, los servicios y las conversaciones con tus clientes.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a4658;">
      Para entrar solo tienes que crear tu contraseña. Pulsa el botón:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
      <tr><td style="background:#6c4cff;border-radius:12px;">
        <a href="${enlace}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Activar mi acceso</a>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#736f83;">
      El enlace caduca en ${datos.diasDeVigencia} días y solo puede usarse una vez. Si caduca, pide que te lo reenvíen.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#736f83;">
      Nadie de Agen te va a pedir tu contraseña. Si no esperabas este correo, ignóralo.
    </p>
  </td></tr>
  <tr><td style="padding:20px 32px;background:#faf9fd;color:#9a96a5;font-size:12px;line-height:1.6;text-align:center;">
    Agen · Agenda y asistente por WhatsApp para negocios de servicios
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

/** Deja registrado el envío. Nunca tumba la operación: la invitación ya salió. */
export async function registrarInvitacion(
  db: SupabaseClient,
  datos: { businessId: string; email: string; userId: string; aceptada: boolean },
): Promise<void> {
  const ahora = new Date()
  const vence = new Date(ahora.getTime() + DIAS_DE_VIGENCIA * 86400000)
  try {
    const { data: previa } = await db.from('business_invitations')
      .select('id,sent_count').eq('business_id', datos.businessId).ilike('email', datos.email).maybeSingle()

    const fila = {
      business_id: datos.businessId,
      email: datos.email,
      user_id: datos.userId,
      status: datos.aceptada ? 'ACCEPTED' : 'PENDING',
      sent_at: ahora.toISOString(),
      expires_at: vence.toISOString(),
      accepted_at: datos.aceptada ? ahora.toISOString() : null,
      updated_at: ahora.toISOString(),
      sent_count: (previa?.sent_count ?? 0) + 1,
    }
    if (previa?.id) await db.from('business_invitations').update(fila).eq('id', previa.id)
    else await db.from('business_invitations').insert(fila)
  } catch (error) {
    registrarAviso('plataforma_invitacion_no_registrada', { detalle: String(error) })
  }
}
