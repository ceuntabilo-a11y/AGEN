import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

export const dynamic = 'force-dynamic'

/**
 * Resumen de la plataforma y salud de los servicios de los que depende Agen.
 *
 * Las comprobaciones de salud van EN PARALELO con las consultas, no después: encadenadas, el
 * viaje a n8n (hasta 4 s) se sumaba al tiempo de las tres consultas, y la pantalla de Monitor
 * se quedaba en "Verificando…" el rato suficiente para que pareciera rota. Es la misma ruta la
 * que alimenta el panel de plataforma, así que ese retraso lo pagaba también quien solo quería
 * ver los números.
 *
 * Que n8n no conteste no es un error de esta ruta: es el dato que se venía a buscar. Por eso
 * cada comprobación captura su propio fallo y devuelve `false`, y nunca tumba la respuesta.
 */

/** Techo de la comprobación de n8n. Si tarda más, para el usuario ya está caído. */
const LIMITE_N8N_MS = 4000

async function n8nSano(): Promise<boolean | null> {
  const base = (process.env.N8N_API_URL || process.env.N8N_WEBHOOK_URL || '')
    .replace(/\/webhook.*$/, '')
    .replace(/\/+$/, '')
  if (!base) return null
  try {
    const respuesta = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(LIMITE_N8N_MS) })
    return respuesta.ok
  } catch {
    return false
  }
}

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const [businesses, professionals, appointments, ping, n8n] = await Promise.all([
      db.from('businesses').select('id,active,suspended_at,membership_plans(price)'),
      db.from('professionals').select('id', { count: 'exact', head: true }).eq('active', true),
      db.from('appointments').select('id', { count: 'exact', head: true }).not('status', 'eq', 'CANCELLED'),
      db.from('businesses').select('id', { count: 'exact', head: true }).limit(1).then(
        (resultado) => !resultado.error,
        () => false,
      ),
      n8nSano(),
    ])
    if (businesses.error) throw businesses.error

    const rows = businesses.data ?? []
    const active = rows.filter((row) => row.active && !row.suspended_at)
    const mrr = active.reduce((sum, row) => sum + Number((row as { membership_plans?: { price?: number } }).membership_plans?.price ?? 0), 0)

    return NextResponse.json({
      businesses: { total: rows.length, active: active.length, suspended: rows.filter((row) => row.suspended_at).length },
      professionals: professionals.count ?? 0,
      appointments: appointments.count ?? 0,
      mrr,
      health: { supabase: ping, n8n },
    })
  } catch (error) { return apiError(error) }
}
