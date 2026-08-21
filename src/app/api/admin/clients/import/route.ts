import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { decidirFila, type ClienteExistente } from '@/lib/import-clientes'

type Row = { fullName?: string; phone?: string; email?: string; birthday?: string; notes?: string }

const MAX_ROWS = 1000

/**
 * Importa clientes desde una planilla ya leída en el navegador.
 *
 * Nunca PISA un dato que el cliente ya tenía. Pero si la fila trae un teléfono o correo que ya
 * existe, en vez de descartarla entera —que era lo único que hacía antes— completa los campos
 * que la ficha tenía vacíos (correo, nacimiento, notas). Es lo que hace falta para poder subir
 * el mismo archivo dos veces: la primera vez crea, la segunda solo agrega lo que faltaba, sin
 * duplicar a nadie ni perder nada de lo que ya se había cargado.
 *
 * La decisión por fila (crear, completar u omitir) vive en `decidirFila` (`@/lib/import-clientes`),
 * pura y probada sin base de datos: acá solo se ejecuta lo que ya se decidió.
 */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const body = await request.json() as { rows?: Row[]; marketingOptIn?: boolean }
    const rows = body.rows
    if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'No hay filas para importar' }, { status: 400 })
    if (rows.length > MAX_ROWS) return NextResponse.json({ error: `Máximo ${MAX_ROWS} filas por importación` }, { status: 400 })

    const { data: existing, error: existingError } = await db.from('clients').select('id,phone,email,birthday,notes').eq('business_id', businessId).limit(5000)
    if (existingError) throw existingError
    const porTelefono = new Map<string, ClienteExistente>()
    const porCorreo = new Map<string, ClienteExistente>()
    for (const cliente of (existing ?? []) as ClienteExistente[]) {
      if (cliente.phone) porTelefono.set(cliente.phone, cliente)
      if (cliente.email) porCorreo.set(cliente.email.toLowerCase(), cliente)
    }

    const toInsert: Array<Record<string, unknown>> = []
    const toUpdate: Array<{ id: string; cambios: Record<string, unknown> }> = []
    const skipped: Array<{ row: number; reason: string }> = []

    rows.forEach((row, index) => {
      const decision = decidirFila({
        fullName: String(row.fullName ?? ''),
        phone: String(row.phone ?? ''),
        email: String(row.email ?? ''),
        birthday: String(row.birthday ?? ''),
        notes: String(row.notes ?? ''),
      }, porTelefono, porCorreo)

      if (decision.accion === 'omitir') { skipped.push({ row: index + 1, reason: decision.motivo }); return }
      if (decision.accion === 'actualizar') { toUpdate.push({ id: decision.id, cambios: decision.cambios }); return }

      // accion === 'crear': se registra en los mapas para que otra fila del MISMO archivo no la duplique.
      const { fullName, phone, email, birthday, notes } = decision.datos
      if (phone) porTelefono.set(phone, { id: '', phone, email, birthday, notes })
      if (email) porCorreo.set(email, { id: '', phone, email, birthday, notes })
      toInsert.push({ business_id: businessId, full_name: fullName, phone, email, birthday, notes, marketing_opt_in: Boolean(body.marketingOptIn) })
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

    let updated = 0
    for (const { id, cambios } of toUpdate) {
      const { error } = await db.from('clients').update(cambios).eq('id', id).eq('business_id', businessId)
      if (error) throw error
      updated += 1
    }

    return NextResponse.json({ created, updated, skipped }, { status: 201 })
  } catch (error) { return apiError(error) }
}
