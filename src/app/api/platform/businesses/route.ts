import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const { data, error } = await db.from('businesses').select('id,name,slug,active,suspended_at,plan_id,created_at,timezone,currency,whatsapp_provider,membership_plans(code,name,price)').order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ businesses: data })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  let createdUserId: string | undefined
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as { name?: string; slug?: string; timezone?: string; currency?: string; planId?: string | null; ownerEmail?: string; ownerName?: string }
    if (!body.name?.trim() || !body.slug?.trim() || !body.ownerEmail?.trim()) return NextResponse.json({ error: 'Nombre, slug y correo del dueño son obligatorios' }, { status: 400 })
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) return NextResponse.json({ error: 'Slug inválido (minúsculas, números y guiones)' }, { status: 400 })
    const email = body.ownerEmail.trim().toLowerCase()
    const { data: business, error: businessError } = await db.from('businesses').insert({
      name: body.name.trim(), slug: body.slug.trim(), timezone: body.timezone || 'America/Santiago', currency: (body.currency || 'CLP').toUpperCase(), plan_id: body.planId || null,
    }).select().single()
    if (businessError) { if (businessError.code === '23505') return NextResponse.json({ error: 'Ese slug ya existe' }, { status: 409 }); throw businessError }
    const cleanupBusiness = async () => { await db.from('businesses').delete().eq('id', business.id) }
    const cleanup = async () => { if (createdUserId) { try { await db.auth.admin.deleteUser(createdUserId) } catch { } } await cleanupBusiness() }
    let userId: string
    let inviteLink: string | null = null
    const link = await db.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` } })
    if (link.error) {
      if (link.error.code !== 'email_exists' && !/already/i.test(link.error.message)) { await cleanupBusiness(); throw link.error }
      const existing = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
      const match = (existing.data.users ?? []).find(user => user.email?.toLowerCase() === email)
      if (existing.error || !match) { await cleanupBusiness(); return NextResponse.json({ error: 'Ese correo ya está registrado y no se pudo vincular automáticamente.' }, { status: 409 }) }
      userId = match.id
    } else {
      userId = link.data.user.id
      inviteLink = link.data.properties.action_link
      createdUserId = userId
    }
    const { error: memberError } = await db.from('business_members').insert({ business_id: business.id, user_id: userId, role: 'OWNER' })
    if (memberError) { await cleanup(); throw memberError }
    return NextResponse.json({ business, inviteLink }, { status: 201 })
  } catch (error) { return apiError(error) }
}
