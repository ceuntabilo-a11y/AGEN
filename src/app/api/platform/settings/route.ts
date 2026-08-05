import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'

const KEYS = ['openai_fallback_key', 'dashscope_fallback_key', 'dashscope_fallback_endpoint']

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const { data, error } = await db.from('platform_settings').select('key,value').in('key', KEYS)
    if (error) throw error
    const settings = Object.fromEntries(KEYS.map(key => [key, data?.find(row => row.key === key)?.value ?? null]))
    return NextResponse.json({ settings })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const { db } = await requirePlatformAdmin()
    const body = await request.json() as Record<string, unknown>
    const entries = Object.entries(body).filter(([key]) => KEYS.includes(key))
    if (!entries.length) return NextResponse.json({ error: 'Nada para guardar' }, { status: 400 })
    for (const [key, value] of entries) {
      const { error } = await db.from('platform_settings').upsert({ key, value, updated_at: new Date().toISOString() })
      if (error) throw error
    }
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
