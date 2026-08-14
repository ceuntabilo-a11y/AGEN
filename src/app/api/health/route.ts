import { NextResponse } from 'next/server'
import { cuerpoDeSalud } from '@/lib/version'

/**
 * Salud del servicio, y qué versión está viva.
 *
 * Dinámica a propósito: `timestamp` tiene que ser el de la petición, no el del build. Aun
 * así es la ruta más barata de la app — no toca base de datos, ni red, ni disco: arma un
 * objeto y lo serializa (ver `src/lib/version.ts` para por qué el commit se resuelve al
 * compilar y no acá).
 *
 * `no-store` explícito: sin él, un proxy intermedio (el Worker de Cloudflare que sirve
 * agen.synetia.site) puede devolver una respuesta guardada y la monitorización acabaría
 * comprobando la salud de una copia vieja — incluido el commit, que es justo el dato que hace
 * falta que sea el de ahora.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export function GET() {
  return NextResponse.json(cuerpoDeSalud(), {
    headers: { 'cache-control': 'no-store, max-age=0' },
  })
}
