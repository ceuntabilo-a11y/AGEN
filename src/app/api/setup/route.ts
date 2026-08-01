import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'

export async function POST(request: Request) {
  const db = createServerSupabase()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Debes iniciar sesión' }, { status: 401 })

  const body = await request.json() as {
    name?: string
    slug?: string
    timezone?: string
    currency?: string
    phone?: string
    address?: string
  }
  if (!body.name?.trim() || !body.slug?.trim()) return NextResponse.json({ error: 'Nombre y código son obligatorios' }, { status: 400 })

  const { data, error } = await db.rpc('create_business_for_owner', {
    p_name: body.name.trim(),
    p_slug: body.slug.trim().toLowerCase(),
    p_timezone: body.timezone || 'America/Santiago',
    p_currency: body.currency || 'CLP',
    p_phone: body.phone?.trim() || null,
    p_email: user.email || null,
    p_address: body.address?.trim() || null,
  })
  if (error) {
    if (error.message.includes('businesses_slug_key')) return NextResponse.json({ error: 'Ese código de negocio ya está ocupado' }, { status: 409 })
    if (error.message.includes('USER_ALREADY_HAS_BUSINESS')) return NextResponse.json({ error: 'Tu cuenta ya pertenece a un negocio' }, { status: 409 })
    return NextResponse.json({ error: 'No se pudo crear el negocio' }, { status: 500 })
  }
  return NextResponse.json({ businessId: data }, { status: 201 })
}
