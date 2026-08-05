import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { connectEvolutionInstance } from '@/lib/whatsapp'

export async function POST() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { data: business, error: businessError } = await db.from('businesses').select('slug,whatsapp_instance').eq('id', businessId).single()
    if (businessError) throw businessError
    const instance = business.whatsapp_instance || `agen-${business.slug || businessId.slice(0, 8)}`
    const result = await connectEvolutionInstance(instance)
    if (!business.whatsapp_instance) await db.from('businesses').update({ whatsapp_instance: instance, whatsapp_provider: 'EVOLUTION' }).eq('id', businessId)
    return NextResponse.json(result)
  } catch (error) { return apiError(error) }
}
