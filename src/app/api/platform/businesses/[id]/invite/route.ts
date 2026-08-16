import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'
import { emitirAcceso, enviarInvitacion, registrarInvitacion } from '@/lib/platform-invitations'

export const dynamic = 'force-dynamic'

/**
 * Reenviar la invitación del dueño.
 *
 * Hace falta porque el enlace caduca: sin esto, un dueño que tardó una semana en abrir el correo
 * se quedaba fuera y la única salida era borrar el negocio y volver a crearlo.
 *
 * Emite un enlace NUEVO —el anterior deja de servir, que es justo lo que se quiere— y reutiliza
 * la cuenta si ya existe, así que reenviar nunca duplica usuarios. Nunca manda una contraseña.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await requirePlatformAdmin()
    const { id } = await params

    const [{ data: negocio, error: errorNegocio }, { data: invitacion }] = await Promise.all([
      db.from('businesses').select('id,name').eq('id', id).single(),
      db.from('business_invitations').select('email').eq('business_id', id).maybeSingle(),
    ])
    if (errorNegocio) throw errorNegocio

    const body = await request.json().catch(() => ({})) as { email?: string }
    const correo = (body.email?.trim() || invitacion?.email || '').toLowerCase()
    if (!correo) return NextResponse.json({ error: 'Este negocio no tiene un correo de dueño registrado' }, { status: 400 })

    const acceso = await emitirAcceso(db, correo)
    if ('error' in acceso) return NextResponse.json({ error: acceso.error }, { status: 409 })

    // Si la cuenta ya existe no hay enlace que mandar: esa persona ya tiene su clave y entra
    // por el login normal. Decirlo es más útil que fingir que se reenvió algo.
    if (!acceso.enlace) {
      await registrarInvitacion(db, { businessId: id, email: correo, userId: acceso.userId, aceptada: true })
      return NextResponse.json({ ok: true, correoEnviado: false, cuentaExistente: true, inviteLink: null })
    }

    const envio = await enviarInvitacion({ email: correo, negocio: negocio.name, enlace: acceso.enlace })
    await registrarInvitacion(db, { businessId: id, email: correo, userId: acceso.userId, aceptada: false })

    return NextResponse.json({
      ok: true,
      correoEnviado: envio.enviado,
      motivo: envio.motivo ?? null,
      cuentaExistente: false,
      inviteLink: acceso.enlace,
    })
  } catch (error) { return apiError(error) }
}
