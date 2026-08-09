import { NextResponse } from 'next/server'
import { requireClientContext } from '@/lib/client-context'
import { apiError } from '@/lib/http-errors'
import { dateKeyInZone } from '@/lib/timezone'

/**
 * Horas disponibles para el portal del cliente.
 *
 * Devuelve además `coverage` y `dayOff`, igual que `/api/admin/slots`: sin eso una lista
 * vacía no distinguía entre "el negocio cierra ese día", "ese profesional no trabaja ese día"
 * y "no quedan horas libres", y el cliente se quedaba sin saber qué pasaba.
 */
export async function POST(request:Request){
  try{
    const {db,businessId}=await requireClientContext()
    const body=await request.json() as {serviceId?:string;from?:string;until?:string}
    if(!body.serviceId||!body.from||!body.until)return NextResponse.json({error:'Faltan datos obligatorios'},{status:400})
    const from=new Date(body.from),until=new Date(body.until)
    if(Number.isNaN(from.getTime())||Number.isNaN(until.getTime())||until<=from||until.getTime()-from.getTime()>14*86400000)return NextResponse.json({error:'Ventana inválida'},{status:400})
    const {data:business}=await db.from('businesses').select('settings,timezone').eq('id',businessId).single()
    const timezone=business?.timezone??'America/Santiago'
    const interval=Math.min(120,Math.max(5,Number(business?.settings?.booking_interval_minutes??15)))

    // El día de la semana se calcula en la zona del negocio, nunca en la del servidor.
    const dayKey=dateKeyInZone(from,timezone)
    const [year,month,day]=dayKey.split('-').map(Number)
    const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay()||7

    const [slots,coverage]=await Promise.all([
      db.rpc('find_service_slots',{p_business_id:businessId,p_service_id:body.serviceId,p_from:from.toISOString(),p_until:until.toISOString(),p_interval_minutes:interval,p_limit:50}),
      db.rpc('service_weekday_coverage',{p_business_id:businessId,p_service_id:body.serviceId,p_weekday:weekday,p_day:dayKey}),
    ])
    if(slots.error)throw slots.error

    const team=(coverage.data??[]) as Array<{professional_id:string;professional_name:string;works:boolean;starts_at:string|null;ends_at:string|null}>
    return NextResponse.json({
      slots:slots.data,
      dayKey,
      coverage:team,
      dayOff:team.length>0&&team.every((item)=>!item.works),
    })
  }catch(error){return apiError(error)}
}
