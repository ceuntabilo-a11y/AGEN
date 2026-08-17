import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'
import { diasRestantes, estadoDeNegocio, slugDesdeNombre, slugValido, vencimientoDesdeDuracion } from '@/lib/platform-business'
import { emitirAcceso, enviarInvitacion, registrarInvitacion } from '@/lib/platform-invitations'
import { insertarNegocio, negociosConVigencia } from '@/lib/platform-schema'

export const dynamic = 'force-dynamic'

const hoyISO = () => new Date().toISOString().slice(0, 10)
const esFecha = (valor: unknown): valor is string => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    // Las invitaciones vencidas se marcan de verdad antes de listarlas: si solo se calculara al
    // pintarlas, la base diría "pendiente" para siempre y el reenvío nunca se ofrecería.
    await db.rpc('expire_stale_invitations').then(() => undefined, () => undefined)

    const [negocios, invitaciones] = await Promise.all([
      negociosConVigencia<{ id: string; created_at?: string | null }>(
        (columnas) => db.from('businesses').select(columnas).order('created_at', { ascending: false }),
        'id,name,slug,active,suspended_at,plan_id,created_at,timezone,currency,whatsapp_provider,membership_plans(code,name,price)',
      ),
      db.from('business_invitations').select('business_id,email,status,sent_at,expires_at,accepted_at,sent_count'),
    ])
    if (negocios.error) throw negocios.error

    const porNegocio = new Map((invitaciones.data ?? []).map((fila) => [fila.business_id, fila]))
    const hoy = hoyISO()
    return NextResponse.json({
      businesses: (negocios.data ?? []).map((negocio) => ({
        ...negocio,
        estado: estadoDeNegocio(negocio, hoy),
        restantes: diasRestantes(negocio.expires_on, hoy),
        invitacion: porNegocio.get(negocio.id) ?? null,
      })),
    })
  } catch (error) { return apiError(error) }
}

/**
 * Crear un negocio y darle acceso a su dueño, en una sola operación.
 *
 * Dos cosas que no se negocian:
 * 1. **Por correo nunca viaja una contraseña.** El dueño recibe un enlace de invitación de
 *    Supabase, caduca solo, y pone su clave él. Ver `@/lib/platform-invitations`.
 * 2. **O queda todo, o no queda nada.** Si falla el usuario o la pertenencia, el negocio recién
 *    creado se borra: media creación deja un negocio sin dueño que nadie puede administrar y
 *    que además ocupa el slug.
 */
export async function POST(request: Request) {
  let creado: { id: string } | null = null
  let usuarioNuevo: string | null = null
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as {
      name?: string; slug?: string; timezone?: string; currency?: string; planId?: string | null
      ownerEmail?: string; isDemo?: boolean; startsOn?: string; durationDays?: number | null; expiresOn?: string | null
    }

    const nombre = body.name?.trim() ?? ''
    const correo = body.ownerEmail?.trim().toLowerCase() ?? ''
    if (!nombre || !correo) return NextResponse.json({ error: 'El nombre y el correo del dueño son obligatorios' }, { status: 400 })
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return NextResponse.json({ error: 'El correo del dueño no es válido' }, { status: 400 })

    // El slug se genera desde el nombre si no lo mandan: el administrador no tiene por qué
    // saber qué es. Si lo mandan, se valida igual.
    const slug = (body.slug?.trim() || slugDesdeNombre(nombre))
    if (!slugValido(slug)) return NextResponse.json({ error: 'La dirección web solo admite minúsculas, números y guiones' }, { status: 400 })

    const inicio = esFecha(body.startsOn) ? body.startsOn : hoyISO()
    const vence = esFecha(body.expiresOn)
      ? body.expiresOn
      : vencimientoDesdeDuracion(inicio, body.durationDays ?? null)
    if (vence && vence < inicio) return NextResponse.json({ error: 'El vencimiento no puede ser anterior al inicio' }, { status: 400 })

    const { data: negocio, error: errorNegocio } = await insertarNegocio(db, {
      name: nombre,
      slug,
      timezone: body.timezone || 'America/Santiago',
      currency: (body.currency || 'CLP').toUpperCase(),
      plan_id: body.planId || null,
      is_demo: body.isDemo === true,
      starts_on: inicio,
      expires_on: vence,
    })
    if (errorNegocio) {
      if (errorNegocio.code === '23505') return NextResponse.json({ error: 'Ya existe un negocio con esa dirección web' }, { status: 409 })
      throw errorNegocio
    }
    creado = negocio as { id: string }

    const deshacer = async () => {
      if (usuarioNuevo) { try { await db.auth.admin.deleteUser(usuarioNuevo) } catch { /* ya no existe */ } }
      if (creado) await db.from('businesses').delete().eq('id', creado.id)
    }

    const acceso = await emitirAcceso(db, correo)
    if ('error' in acceso) { await deshacer(); return NextResponse.json({ error: acceso.error }, { status: 409 }) }
    if (!acceso.yaExistia) usuarioNuevo = acceso.userId

    const { error: errorMiembro } = await db.from('business_members')
      .insert({ business_id: negocio!.id, user_id: acceso.userId, role: 'OWNER' })
    if (errorMiembro) { await deshacer(); throw errorMiembro }

    let correoEnviado = false
    if (acceso.enlace) {
      const envio = await enviarInvitacion({ email: correo, negocio: nombre, enlace: acceso.enlace })
      correoEnviado = envio.enviado
    }
    await registrarInvitacion(db, { businessId: String(negocio!.id), email: correo, userId: acceso.userId, aceptada: acceso.yaExistia })

    return NextResponse.json({
      business: negocio,
      // El enlace vuelve para que el administrador pueda pasarlo a mano si el correo no salió.
      inviteLink: acceso.enlace,
      correoEnviado,
      cuentaExistente: acceso.yaExistia,
    }, { status: 201 })
  } catch (error) { return apiError(error) }
}
