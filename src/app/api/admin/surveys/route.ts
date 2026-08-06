import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

const missingTable = (error: { code?: string } | null) => error?.code === '42P01'

/** NPS = % promotores (9-10) menos % detractores (0-6), sobre las respuestas de los últimos 12 meses. */
export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const since = new Date(Date.now() - 365 * 86400000).toISOString()
    const { data, error } = await db.from('survey_responses').select('id,score,comment,source,created_at,client:clients(id,full_name),professional:professionals(id,display_name)').eq('business_id', businessId).gte('created_at', since).order('created_at', { ascending: false }).limit(500)
    if (missingTable(error)) return NextResponse.json({ pendingMigration: true, responses: [], nps: null, distribution: [], promoters: 0, passives: 0, detractors: 0, average: 0 })
    if (error) throw error

    const rows = data ?? []
    const promoters = rows.filter((row) => row.score >= 9).length
    const detractors = rows.filter((row) => row.score <= 6).length
    const distribution = Array.from({ length: 11 }, (_, score) => ({ score, count: rows.filter((row) => row.score === score).length }))
    return NextResponse.json({
      responses: rows,
      nps: rows.length ? Math.round((promoters - detractors) / rows.length * 100) : null,
      promoters,
      passives: rows.length - promoters - detractors,
      detractors,
      average: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length * 10) / 10 : 0,
      distribution,
    })
  } catch (error) { return apiError(error) }
}

export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'RECEPTIONIST'])
    const body = await request.json() as { clientId?: string; professionalId?: string | null; score?: number; comment?: string }
    const score = Number(body.score)
    if (!Number.isInteger(score) || score < 0 || score > 10) return NextResponse.json({ error: 'La nota debe ser un número entre 0 y 10' }, { status: 400 })
    if (body.clientId) {
      const { data: client, error: clientError } = await db.from('clients').select('id').eq('business_id', businessId).eq('id', body.clientId).maybeSingle()
      if (clientError) throw clientError
      if (!client) return NextResponse.json({ error: 'Ese cliente no pertenece al negocio' }, { status: 404 })
    }
    const { data, error } = await db.from('survey_responses').insert({
      business_id: businessId,
      client_id: body.clientId ?? null,
      professional_id: body.professionalId ?? null,
      score,
      comment: body.comment?.trim().slice(0, 1000) || null,
      source: 'MANUAL',
    }).select('id,score').single()
    if (missingTable(error)) return NextResponse.json({ error: 'Falta aplicar la migración de encuestas (supabase/migrations/20260806000001_satisfaction_surveys.sql)' }, { status: 503 })
    if (error) throw error
    return NextResponse.json({ response: data }, { status: 201 })
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Falta la respuesta' }, { status: 400 })
    const { data, error } = await db.from('survey_responses').delete().eq('id', id).eq('business_id', businessId).select('id').maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Esa respuesta no pertenece al negocio' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
