import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { evolutionConnectionState } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { data: business, error } = await db.from('businesses').select('whatsapp_instance,whatsapp_provider').eq('id', businessId).single()
    if (error) throw error
    if (business.whatsapp_provider !== 'EVOLUTION' || !business.whatsapp_instance) return NextResponse.json({ instance: null, state: 'close' })
    const state = await evolutionConnectionState(business.whatsapp_instance)
    return NextResponse.json({ instance: business.whatsapp_instance, state })
  } catch (error) { return apiError(error) }
}
