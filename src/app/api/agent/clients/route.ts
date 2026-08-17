import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { rejectTeamActor } from '@/lib/agent-actor'
import { guardarClienteDelAgente } from '@/lib/agent-booking'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as { businessId?: string; phone?: string; fullName?: string; email?: string; birthday?: string; marketingOptIn?: boolean }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) return NextResponse.json({ error: 'Negocio o teléfono inválido', motivo: 'DATO_INVALIDO' }, { status: 400 })

  const db = createAdminClient()
  if (await rejectTeamActor(db, body.businessId, phone)) return NextResponse.json({ error: 'El equipo no puede registrarse como cliente desde el agente', motivo: 'NO_AUTORIZADO' }, { status: 403 })
  const { data: business } = await db.from('businesses').select('id').eq('id', body.businessId).eq('active', true).maybeSingle()
  if (!business) return NextResponse.json({ error: 'Negocio inexistente', motivo: 'NO_EXISTE' }, { status: 404 })

  const resultado = await guardarClienteDelAgente(db, {
    businessId: body.businessId,
    phone,
    fullName: body.fullName,
    email: body.email,
    birthday: body.birthday,
    marketingOptIn: body.marketingOptIn,
  })

  if (!resultado.ok) {
    const cuerpo: Record<string, unknown> = { error: resultado.error, motivo: resultado.motivo }
    if (resultado.needsName) cuerpo.needsName = true
    return NextResponse.json(cuerpo, { status: resultado.estado })
  }

  return resultado.created
    ? NextResponse.json({ created: true, motivo: 'OK', client: resultado.client }, { status: 201 })
    : NextResponse.json({ created: false, motivo: 'OK', client: resultado.client })
}
