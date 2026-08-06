import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { normalizePhone } from '@/lib/phone'

type Row = { fullName?: string; phone?: string; email?: string; birthday?: string; notes?: string }

const MAX_ROWS = 1000

/** Importa clientes desde una planilla ya leída en el navegador. Nunca pisa un cliente existente. */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as { rows?: Row[]; marketingOptIn?: boolean }
    const rows = body.rows
    if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'No hay filas para importar' }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Máximo ${MAX_ROWS} filas por importación` }, { status: 400 })

    const { data: existing, error: existingError } = await db.from('clients').select('phone,email').eq('business_id', businessId).limit(5000)
    if (existingError) throw existingError
    const phones = new Set((existing ?? []).map((client) => client.phone).filter(Boolean))
    const emails = new Set((existing ?? []).map((client) => (client.email ?? '').toLowerCase()).filter(Boolean))

    const toInsert: Array<Record<string, unknown>> = []
    const skipped: Array<{ row: number; reason: string }> = []
    rows.forEach((row, index) => {
      const fullName = String(row.fullName ?? '').trim()
      if (!fullName) { skipped.push({ row: index + 1, reason: 'Sin nombre' }); return }
      const rawPhone = String(row.phone ?? '').trim()
      const phone = rawPhone ? normalizePhone(rawPhone) : null
      if (rawPhone && !phone) { skipped.push({ row: index + 1, reason: `Teléfono inválido (${rawPhone})` }); return }
      if (phone && phones.has(phone)) { skipped.push({ row: index + 1, reason: 'Ya existe un cliente con ese teléfono' }); return }
      const email = String(row.email ?? '').trim().toLowerCase() || null
      if (email && emails.has(email)) { skipped.push({ row: index + 1, reason: 'Ya existe un cliente con ese correo' }); return }
      const birthday = String(row.birthday ?? '').trim()
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) { skipped.push({ row: index + 1, reason: 'Fecha de nacimiento inválida (usa AAAA-MM-DD)' }); return }
      if (phone) phones.add(phone)
      if (email) emails.add(email)
      toInsert.push({
        business_id: businessId,
        full_name: fullName.slice(0, 160),
        phone,
        email,
        birthday: birthday || null,
        notes: String(row.notes ?? '').trim().slice(0, 1000) || null,
        marketing_opt_in: Boolean(body.marketingOptIn),
      })
    })

    let created = 0
    for (let start = 0; start < toInsert.length; start += 200) {
      const batch = toInsert.slice(start, start + 200)
      const { data, error } = await db.from('clients').insert(batch).select('id,phone,email')
      if (error) throw error
      created += data?.length ?? 0
      // El consentimiento solo se registra si el usuario declaró tenerlo: el marketing nunca sale sin permiso.
      if (body.marketingOptIn && data?.length) {
        const consents = data.flatMap((client) => [
          ...(client.phone ? [{ client_id: client.id, channel: 'WHATSAPP', purpose: 'MARKETING', granted: true, source: 'IMPORT' }] : []),
          ...(client.email ? [{ client_id: client.id, channel: 'EMAIL', purpose: 'MARKETING', granted: true, source: 'IMPORT' }] : []),
        ])
        if (consents.length) {
          const { error: consentError } = await db.from('communication_consents').upsert(consents, { onConflict: 'client_id,channel,purpose' })
          if (consentError) throw consentError
        }
      }
    }

    return NextResponse.json({ created, skipped }, { status: 201 })
  } catch (error) { return apiError(error) }
}
