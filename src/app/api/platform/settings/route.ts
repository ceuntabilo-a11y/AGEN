import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'
import { registrarAviso, registrarError } from '@/lib/observabilidad'
import { CLAVES_PLATAFORMA, hayCambios, normalizarEntradas, vistaSegura } from '@/lib/platform-settings'

export const dynamic = 'force-dynamic'

/**
 * Claves de plataforma.
 *
 * GET nunca devuelve una credencial en claro: de las secretas solo dice si están puestas y
 * sus últimos cuatro caracteres. Antes se devolvían enteras al navegador.
 *
 * PATCH no escribe `null` jamás. La columna es `jsonb not null`, así que el formulario, que
 * mandaba `null` por cada campo en blanco, tumbaba el guardado completo — llenar solo la clave
 * de DashScope y dejar el resto vacío bastaba para que no se guardara nada. Ahora: campo
 * ausente = no se toca, campo vacío = se borra la fila, campo con texto = se guarda.
 */
export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const { data, error } = await db.from('platform_settings').select('key,value').in('key', [...CLAVES_PLATAFORMA])
    if (error) throw error
    return NextResponse.json({ settings: vistaSegura(data ?? []) })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db } = await requirePlatformAdmin()
    const cuerpo = await request.json().catch(() => ({}))
    const entradas = normalizarEntradas(cuerpo)

    if (entradas.desconocidas.length) {
      // No se falla por esto —el formulario puede crecer— pero queda registrado.
      registrarAviso('plataforma_claves_desconocidas', { claves: entradas.desconocidas })
    }
    if (!hayCambios(entradas)) {
      return NextResponse.json({ error: 'No enviaste ningún cambio' }, { status: 400 })
    }

    // Una sola escritura para todo lo que se guarda: o entra el lote completo, o no entra nada.
    if (entradas.guardar.length) {
      const ahora = new Date().toISOString()
      const { error } = await db.from('platform_settings')
        .upsert(entradas.guardar.map((item) => ({ ...item, updated_at: ahora })), { onConflict: 'key' })
      if (error) {
        registrarError('plataforma_claves_guardar', { claves: entradas.guardar.map((i) => i.key), codigo: error.code, detalle: error.message })
        return NextResponse.json({ error: 'No se pudieron guardar las claves. Revisa los logs del servidor.' }, { status: 500 })
      }
    }

    if (entradas.borrar.length) {
      const { error } = await db.from('platform_settings').delete().in('key', entradas.borrar)
      if (error) {
        registrarError('plataforma_claves_borrar', { claves: entradas.borrar, codigo: error.code, detalle: error.message })
        return NextResponse.json({ error: 'No se pudieron quitar las claves. Revisa los logs del servidor.' }, { status: 500 })
      }
    }

    return NextResponse.json({
      ok: true,
      guardadas: entradas.guardar.map((item) => item.key),
      quitadas: entradas.borrar,
    })
  } catch (error) { return apiError(error) }
}
