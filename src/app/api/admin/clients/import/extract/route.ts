import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { chatCompletion, resolveOpenAiKey } from '@/lib/openai'
import { rateLimited } from '@/lib/rate-limit'

const MAX_TEXTO = 6000
const MAX_FILAS = 500

const PROMPT_SISTEMA = [
  'Extraes contactos de clientes de un texto suelto (una nota, un documento, una lista pegada a mano).',
  'Devuelves EXCLUSIVAMENTE un objeto JSON con esta forma, sin texto antes ni después:',
  '{"clientes":[{"fullName":"","phone":"","email":"","birthday":"","notes":""}]}',
  '',
  'Reglas:',
  '- Un cliente por cada persona identificable en el texto. Si no hay ninguna, "clientes" es una lista vacía.',
  '- NUNCA inventes un nombre, teléfono, correo o fecha que no esté escrito en el texto. Si un dato no aparece, va como cadena vacía "".',
  '- "birthday" solo si el texto trae una fecha de nacimiento completa, en formato AAAA-MM-DD. Si falta el año, déjalo vacío.',
  '- "notes" solo si queda algo relevante que no entra en los otros campos (una dirección, un comentario). Si no, vacío.',
  '- Corrige errores de tipeo obvios en el nombre (mayúsculas, espacios de más) pero no cambies su significado.',
].join('\n')

type Cliente = { fullName?: unknown; phone?: unknown; email?: unknown; birthday?: unknown; notes?: unknown }

/** Extrae clientes de un texto suelto (nota, .txt, .docx ya convertido) con IA. Nunca escribe nada: solo propone filas para la vista previa de la importación. */
export async function POST(request: Request) {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    if (rateLimited(`import-extract:${businessId}`, 15, 60_000)) return NextResponse.json({ error: 'Demasiados intentos, espera un minuto' }, { status: 429 })

    const body = await request.json().catch(() => ({})) as { text?: string }
    const texto = String(body.text ?? '').trim()
    if (!texto) return NextResponse.json({ error: 'No hay texto para leer' }, { status: 400 })

    const { data: business } = await db.from('businesses').select('openai_api_key').eq('id', businessId).single()
    const { key } = await resolveOpenAiKey(business?.openai_api_key ?? null)
    if (!key) return NextResponse.json({ error: 'Configura tu clave de OpenAI en Integraciones para leer archivos con IA' }, { status: 400 })

    const recortado = texto.length > MAX_TEXTO
    const respuesta = await chatCompletion(key, [
      { role: 'system', content: PROMPT_SISTEMA },
      { role: 'user', content: texto.slice(0, MAX_TEXTO) },
    ], { model: 'gpt-4o-mini', maxTokens: 3000, temperature: 0, json: true })

    let crudo: unknown
    try { crudo = JSON.parse(respuesta) } catch { return NextResponse.json({ error: 'La IA no devolvió un resultado que se pudiera leer, prueba de nuevo' }, { status: 502 }) }
    const lista = Array.isArray((crudo as { clientes?: unknown })?.clientes) ? (crudo as { clientes: Cliente[] }).clientes : []

    const rows = lista.slice(0, MAX_FILAS)
      .map((cliente) => ({
        fullName: String(cliente.fullName ?? '').trim().slice(0, 160),
        phone: String(cliente.phone ?? '').trim().slice(0, 40),
        email: String(cliente.email ?? '').trim().slice(0, 200),
        birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(cliente.birthday ?? '')) ? String(cliente.birthday) : '',
        notes: String(cliente.notes ?? '').trim().slice(0, 1000),
      }))
      .filter((row) => row.fullName)

    return NextResponse.json({ rows, truncated: recortado })
  } catch (error) { return apiError(error) }
}
