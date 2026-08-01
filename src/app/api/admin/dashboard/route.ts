import { NextResponse } from 'next/server'
import { apiError } from '@/lib/http-errors'
import { requireBusinessContext } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { db, businessId } = await requireBusinessContext()
    const today = new Date(); today.setHours(0,0,0,0); const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1)
    const [appointments, payments, clients, professionals] = await Promise.all([
      db.from('appointments').select('id,status,service_period,quoted_price,client:clients(full_name),professional:professionals(display_name,color),service:services(name)').eq('business_id',businessId).overlaps('service_period',`[${today.toISOString()},${tomorrow.toISOString()})`),
      db.from('payments').select('amount,status').eq('business_id',businessId).eq('status','PAID').gte('paid_at',today.toISOString()).lt('paid_at',tomorrow.toISOString()),
      db.from('clients').select('id',{count:'exact',head:true}).eq('business_id',businessId).gte('created_at',today.toISOString()),
      db.from('professionals').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('active',true),
    ])
    const error=appointments.error||payments.error||clients.error||professionals.error
    if(error)throw error
    return NextResponse.json({ appointments: appointments.data, revenue: payments.data?.reduce((sum,p)=>sum+Number(p.amount),0)??0, newClients: clients.count??0, activeProfessionals: professionals.count??0 })
  } catch(error){return apiError(error)}
}
