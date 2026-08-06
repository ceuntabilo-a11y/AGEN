import type { SupabaseClient } from '@supabase/supabase-js'

export const PORTFOLIO_BUCKET = 'portfolio'
const SIGNED_SECONDS = 3600

/**
 * Las fotos de la galería son de clientes: el bucket es privado y cada lectura
 * genera un enlace firmado que caduca en una hora. En la base se guarda la URL
 * canónica (…/object/public/portfolio/<ruta>) como referencia estable.
 */
export function portfolioPathFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  const match = value.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/portfolio\/([^?]+)/)
  if (match) return decodeURIComponent(match[1])
  // Una ruta guardada directamente (sin dominio) también es válida.
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) return value
  return null
}

export function portfolioPublicUrl(supabaseUrl: string, path: string) {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${PORTFOLIO_BUCKET}/${path}`
}

type Item = Record<string, unknown>

/** Reemplaza before_url/after_url por enlaces firmados. Las URLs externas se dejan intactas. */
export async function signPortfolioItems<T extends Item>(db: SupabaseClient, items: T[] | null): Promise<T[]> {
  const rows = items ?? []
  if (!rows.length) return rows
  const paths = new Set<string>()
  for (const row of rows) {
    for (const field of ['before_url', 'after_url'] as const) {
      const path = portfolioPathFromUrl(row[field] as string | null)
      if (path) paths.add(path)
    }
  }
  if (!paths.size) return rows

  const list = Array.from(paths)
  const { data, error } = await db.storage.from(PORTFOLIO_BUCKET).createSignedUrls(list, SIGNED_SECONDS)
  if (error) return rows
  const signed = new Map<string, string>()
  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) signed.set(entry.path, entry.signedUrl)
  }
  return rows.map((row) => {
    const next = { ...row }
    for (const field of ['before_url', 'after_url'] as const) {
      const path = portfolioPathFromUrl(row[field] as string | null)
      const url = path ? signed.get(path) : null
      if (url) (next as Item)[field] = url
    }
    return next
  })
}
