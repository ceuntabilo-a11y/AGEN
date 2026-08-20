import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { PORTFOLIO_BUCKET, portfolioPublicUrl } from '@/lib/storage'

const BUCKETS: Record<string, { bucket: string; maxBytes: number }> = {
  logo: { bucket: 'business-assets', maxBytes: 5 * 1024 * 1024 },
  campaign: { bucket: 'business-assets', maxBytes: 5 * 1024 * 1024 },
  professional: { bucket: 'business-assets', maxBytes: 5 * 1024 * 1024 },
  portfolio: { bucket: 'portfolio', maxBytes: 10 * 1024 * 1024 },
}
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/** Sube una imagen a Supabase Storage con la service role (nunca desde el navegador) y devuelve su URL pública. */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN', 'PROFESSIONAL'])
    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') ?? 'campaign')
    const target = BUCKETS[kind]
    if (!target) return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    const extension = TYPES[file.type]
    if (!extension) return NextResponse.json({ error: 'Solo se permiten imágenes JPG, PNG, WEBP o SVG' }, { status: 400 })
    if (kind === 'portfolio' && extension === 'svg') return NextResponse.json({ error: 'Para la galería usa JPG, PNG o WEBP' }, { status: 400 })
    if (file.size > target.maxBytes) return NextResponse.json({ error: `La imagen supera el máximo de ${Math.round(target.maxBytes / 1024 / 1024)} MB` }, { status: 400 })

    const path = `${businessId}/${kind}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`
    const { error } = await db.storage.from(target.bucket).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false })
    if (error) throw error
    // La galería es privada: se guarda la URL canónica y se devuelve además un enlace firmado para la vista previa.
    if (target.bucket === PORTFOLIO_BUCKET) {
      const signed = await db.storage.from(PORTFOLIO_BUCKET).createSignedUrl(path, 3600)
      return NextResponse.json({ url: portfolioPublicUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', path), previewUrl: signed.data?.signedUrl ?? null, path }, { status: 201 })
    }
    const { data } = db.storage.from(target.bucket).getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl, path }, { status: 201 })
  } catch (error) { return apiError(error) }
}
