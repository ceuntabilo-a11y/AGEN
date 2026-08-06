import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const csv = (headers: string[], rows: Array<Array<unknown>>) => [headers.join(';'), ...rows.map((row) => row.map(cell).join(';'))].join('\r\n')
const rangeStart = (value: string) => value.replace(/[[\]()"]/g, '').split(',')[0]

/** Exporta los datos del negocio en CSV separado por ";" para que Excel en español lo abra directo. */
export async function GET(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const entity = new URL(request.url).searchParams.get('entity') ?? 'clients'

    let filename = ''
    let body = ''
    if (entity === 'clients') {
      const { data, error } = await db.from('clients').select('full_name,phone,email,birthday,marketing_opt_in,notes,created_at').eq('business_id', businessId).order('full_name').limit(5000)
      if (error) throw error
      filename = 'clientes'
      body = csv(['Nombre', 'Teléfono', 'Correo', 'Nacimiento', 'Acepta promociones', 'Notas', 'Registrado'],
        (data ?? []).map((row) => [row.full_name, row.phone, row.email, row.birthday, row.marketing_opt_in ? 'Sí' : 'No', row.notes, row.created_at]))
    } else if (entity === 'appointments') {
      const { data, error } = await db.from('appointments').select('service_period,status,source,quoted_price,client:clients(full_name),professional:professionals(display_name),service:services(name)').eq('business_id', businessId).order('service_period', { ascending: false }).limit(5000)
      if (error) throw error
      filename = 'reservas'
      body = csv(['Fecha', 'Cliente', 'Profesional', 'Servicio', 'Estado', 'Origen', 'Precio'],
        (data ?? []).map((row: any) => [rangeStart(row.service_period), row.client?.full_name, row.professional?.display_name, row.service?.name, row.status, row.source, row.quoted_price]))
    } else if (entity === 'payments') {
      const { data, error } = await db.from('payments').select('amount,status,method,paid_at,created_at,client:clients(full_name)').eq('business_id', businessId).order('created_at', { ascending: false }).limit(5000)
      if (error) throw error
      filename = 'cobros'
      body = csv(['Cliente', 'Monto', 'Estado', 'Método', 'Cobrado el', 'Registrado'],
        (data ?? []).map((row: any) => [row.client?.full_name, row.amount, row.status, row.method, row.paid_at, row.created_at]))
    } else if (entity === 'expenses') {
      const { data, error } = await db.from('expenses').select('category,description,amount,incurred_on').eq('business_id', businessId).order('incurred_on', { ascending: false }).limit(5000)
      if (error) throw error
      filename = 'gastos'
      body = csv(['Categoría', 'Descripción', 'Monto', 'Fecha'], (data ?? []).map((row) => [row.category, row.description, row.amount, row.incurred_on]))
    } else {
      return NextResponse.json({ error: 'Tipo de exportación no válido' }, { status: 400 })
    }

    // BOM para que Excel respete los acentos.
    return new Response(`﻿${body}`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="agen-${filename}.csv"`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) { return apiError(error) }
}
