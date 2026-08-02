'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { dateKeyInZone, formatTimeInZone, zonedDayRange } from '@/lib/timezone'

type Appointment = { id:string; professional:{id:string;display_name:string}|null; service:{id:string;name:string}|null }
type Slot = { professional_id:string; service_start:string }

export function ClientRescheduleModal({appointment,timezone,onClose,onUpdated}:{appointment:Appointment;timezone:string;onClose:()=>void;onUpdated:()=>void}){
  const [date,setDate]=useState(dateKeyInZone(new Date(Date.now()+86400000),timezone))
  const [slots,setSlots]=useState<Slot[]>([])
  const [selected,setSelected]=useState('')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  async function search(){if(!appointment.service?.id||!appointment.professional?.id)return;setError('');setSelected('');const {from,until}=zonedDayRange(date,timezone);const response=await fetch('/api/client/slots',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({serviceId:appointment.service.id,from,until})});const data=await response.json();if(!response.ok){setError(data.error??'No se pudo buscar');return}setSlots((data.slots??[]).filter((slot:Slot)=>slot.professional_id===appointment.professional?.id))}
  async function save(){if(!selected)return;setLoading(true);const response=await fetch('/api/client/appointments',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({appointmentId:appointment.id,action:'reschedule',newStart:selected})});const data=await response.json();if(!response.ok){setError(data.error??'No se pudo reagendar');setLoading(false);return}onUpdated();onClose()}
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><section className="w-full max-w-lg rounded-3xl bg-white p-6"><div className="flex justify-between"><div><h2 className="text-xl font-black">Reagendar reserva</h2><p className="text-sm text-[#736f83]">{appointment.service?.name} con {appointment.professional?.display_name}</p></div><button aria-label="Cerrar" onClick={onClose}><X/></button></div><div className="mt-5 flex gap-2"><input type="date" min={dateKeyInZone(new Date(),timezone)} value={date} onChange={(event)=>{setDate(event.target.value);setSlots([]);setSelected('')}} className="flex-1 rounded-xl border p-3"/><button onClick={search} className="rounded-xl border border-[#5b3df5] px-4 font-bold text-[#5b3df5]">Buscar</button></div><div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">{slots.map((slot)=><button key={slot.service_start} onClick={()=>setSelected(slot.service_start)} className={`rounded-lg border p-2 text-sm font-bold ${selected===slot.service_start?'bg-[#5b3df5] text-white':''}`}>{formatTimeInZone(slot.service_start,timezone)}</button>)}</div>{slots.length===0&&<p className="mt-4 text-sm text-[#736f83]">Busca una fecha para ver horarios disponibles.</p>}{error&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={!selected||loading} onClick={save} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading?'Confirmando…':'Confirmar nueva hora'}</button></section></div>
}
