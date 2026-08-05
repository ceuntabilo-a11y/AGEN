import { NextResponse } from 'next/server'
import { requireBusinessContext } from '@/lib/supabase-server'
import { apiError } from '@/lib/http-errors'
import { disconnectEvolutionInstance } from '@/lib/whatsapp'

export async function POST() {
  try {
    const { db, businessId } = await requireBusinessContext(['OWNER', 'ADMIN'])
    const { data: business, error } = await db.from('businesses').select('whatsapp_instance').eq('id', businessId).single()
    if (error) throw error
    if (business.whatsapp_instance) await disconnectEvolutionInstance(business.whatsapp_instance)
    return NextResponse.json({ ok: true })
  } catch (error) { return apiError(error) }
}
