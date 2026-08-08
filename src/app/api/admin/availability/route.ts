import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { parseAvailability, readAvailability, replaceAvailability } from '@/lib/availability'
import { loadBusinessHours, validateAgainstBusinessHours } from '@/lib/business-hours'

export const dynamic = 'force-dynamic'

async function ownProfessional(db: Awaited<ReturnType<typeof requireBusinessContext>>['db'], businessId: string, professionalId: string) {
  const { data, error } = await db.from('professionals').select('id').eq('business_id', businessId).eq('id', professionalId).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const professionalId = new URL(request.url).searchParams.get('professionalId')
    if (!professionalId) return NextResponse.json({ error: 'Falta el profesional' }, { status: 400 })
    if (!await ownProfessional(db, businessId, professionalId)) return NextResponse.json({ error: 'Ese profesional no pertenece al negocio' }, { status: 404 })
    return NextResponse.json({ availability: await readAvailability(db, professionalId), businessHours: await loadBusinessHours(db, businessId) })
  } catch (error) { return apiError(error) }
}

export async function PUT(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as { professionalId?: string; availability?: unknown }
    if (!body.professionalId) return NextResponse.json({ error: 'Falta el profesional' }, { status: 400 })
    if (!await ownProfessional(db, businessId, body.professionalId)) return NextResponse.json({ error: 'Ese profesional no pertenece al negocio' }, { status: 404 })
    const parsed = parseAvailability(body.availability)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const hours = await loadBusinessHours(db, businessId)
    const outside = validateAgainstBusinessHours(parsed.slots, hours)
    if (outside) return NextResponse.json({ error: outside }, { status: 400 })
    await replaceAvailability(db, body.professionalId, parsed.slots)
    return NextResponse.json({ availability: await readAvailability(db, body.professionalId), businessHours: hours })
  } catch (error) { return apiError(error) }
}
