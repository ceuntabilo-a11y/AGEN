import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import mammoth from 'mammoth'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_TEXTO = 20000

/**
 * Saca el texto plano de un .docx. Es el único formato de esta importación que necesita
 * pasar por el servidor: `mammoth` lee el archivo (es un zip por dentro) y no tiene una
 * versión pensada para correr en el navegador. Nada se guarda: se lee y se descarta.
 */
export async function POST(request: Request) {
  try {
    await requireBusinessContext(['OWNER', 'ADMIN'])
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El archivo supera el máximo de 5 MB' }, { status: 400 })

    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const resultado = await mammoth.extractRawText({ buffer })
      return NextResponse.json({ text: resultado.value.slice(0, MAX_TEXTO) })
    } catch {
      return NextResponse.json({ error: 'No se pudo leer ese archivo Word' }, { status: 400 })
    }
  } catch (error) { return apiError(error) }
}
