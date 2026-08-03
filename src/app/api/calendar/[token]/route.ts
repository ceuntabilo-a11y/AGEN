import {NextResponse} from 'next/server'
import {createAdminClient} from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

const clean=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
const stamp=(value:Date)=>value.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')
const range=(value:string)=>value.replace(/[\[\]()"]/g,'').split(',')
const fold=(line:string)=>{const parts:string[]=[];let rest=line;while(Buffer.byteLength(rest,'utf8')>75){let cut=70;while(Buffer.byteLength(rest.slice(0,cut),'utf8')>73)cut--;parts.push(rest.slice(0,cut));rest=' '+rest.slice(cut)}parts.push(rest);return parts.join('\r\n')}

export async function GET(_:Request,{params}:{params:Promise<{token:string}>}){
  const {token}=await params
  if(!/^[0-9a-f-]{36}$/i.test(token))return new NextResponse('Calendario inexistente',{status:404})
  const db=createAdminClient()
  const {data:professional}=await db.from('professionals').select('id,display_name,business_id,calendar_hide_client_names,business:businesses(name,address,timezone)').eq('calendar_token',token).eq('active',true).maybeSingle()
  if(!professional)return new NextResponse('Calendario inexistente',{status:404})
  const from=new Date(Date.now()-30*86400000).toISOString(),until=new Date(Date.now()+365*86400000).toISOString()
  const {data,error}=await db.from('appointments').select('id,status,service_period,notes,client:clients(full_name),service:services(name)').eq('business_id',professional.business_id).eq('professional_id',professional.id).not('status','eq','CANCELLED').overlaps('service_period',`[${from},${until})`).order('service_period')
  if(error)return new NextResponse('No se pudo generar el calendario',{status:500})
  const business=Array.isArray(professional.business)?professional.business[0]:professional.business
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Agen//Agenda profesional//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${clean(`Agen · ${professional.display_name}`)}`,'X-PUBLISHED-TTL:PT15M']
  for(const appointment of data??[]){const [start,end]=range(appointment.service_period);const client=Array.isArray(appointment.client)?appointment.client[0]:appointment.client;const service=Array.isArray(appointment.service)?appointment.service[0]:appointment.service;const who=professional.calendar_hide_client_names?'Cliente':client?.full_name??'Cliente';lines.push('BEGIN:VEVENT',`UID:${appointment.id}@agen`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(new Date(start))}`,`DTEND:${stamp(new Date(end))}`,`SUMMARY:${clean(`${service?.name??'Reserva'} · ${who}`)}`,`LOCATION:${clean(business?.address??'')}`,`DESCRIPTION:${clean(`Estado: ${appointment.status}`)}`,'END:VEVENT')}
  lines.push('END:VCALENDAR')
  const body=lines.map(fold).join('\r\n')+'\r\n'
  return new NextResponse(body,{headers:{'content-type':'text/calendar; charset=utf-8','content-disposition':'inline; filename="agen.ics"','cache-control':'private, max-age=300'}})
}
