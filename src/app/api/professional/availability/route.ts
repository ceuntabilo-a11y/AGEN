import { NextResponse } from 'next/server'
import { requireProfessionalContext } from '@/lib/professional-context'
import { apiError } from '@/lib/http-errors'
import { parseAvailability, readAvailability, replaceAvailability } from '@/lib/availability'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, professional } = await requireProfessionalContext()
    return NextResponse.json({ availability: await readAvailability(db, professional.id) })
  } catch (error) { return apiError(error) }
}

export async function PUT(request: Request) {
  try {
    const { db, professional } = await requireProfessionalContext()
    const body = await request.json() as { availability?: unknown }
    const parsed = parseAvailability(body.availability)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    await replaceAvailability(db, professional.id, parsed.slots)
    return NextResponse.json({ availability: await readAvailability(db, professional.id) })
  } catch (error) { return apiError(error) }
}
