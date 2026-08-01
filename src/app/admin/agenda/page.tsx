'use client'
import { PageHeader } from '@/components/PageHeader'
import { appointments as demoAppointments, professionals as demoProfessionals, services as demoServices } from '@/lib/demo-data'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NewAppointmentModal } from '@/components/NewAppointmentModal'

type Professional={id:string;name:string;specialty:string;color:string;initials:string}
type Appointment={id:string;time:string;end:string;client:string;professionalId:string;serviceName:string;status:string}
const hours=Array.from({length:11},(_,i)=>`${String(i+8).padStart(2,'0')}:00`)
const rangeDates=(range:string)=>{const parts=range.replace(/[\[\]()"]/g,'').split(',');return [new Date(parts[0]),new Date(parts[1])] as const}
const hhmm=(date:Date)=>date.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',hour12:false})

export default function AgendaPage(){
  const [selected,setSelected]=useState('all'),[loading,setLoading]=useState(true),[live,setLive]=useState(false)
  const [showNew,setShowNew]=useState(false),[revision,setRevision]=useState(0)
  const [professionals,setProfessionals]=useState<Professional[]>(demoProfessionals)
  const [appointments,setAppointments]=useState<Appointment[]>(demoAppointments.map(a=>({...a,serviceName:demoServices.find(s=>s.id===a.serviceId)?.name??''})))
  const day=useMemo(()=>{const start=new Date();start.setHours(0,0,0,0);const end=new Date(start);end.setDate(end.getDate()+1);return {start,end}},[])
  useEffect(()=>{Promise.all([fetch('/api/admin/catalog').then(r=>{if(!r.ok)throw new Error();return r.json()}),fetch(`/api/admin/agenda?from=${day.start.toISOString()}&until=${day.end.toISOString()}`).then(r=>{if(!r.ok)throw new Error();return r.json()})]).then(([catalog,agenda])=>{const mapped:Professional[]=catalog.professionals.map((p:any)=>({id:p.id,name:p.display_name,specialty:(p.professional_specialties?.[0]&&catalog.specialties.find((s:any)=>s.id===p.professional_specialties[0].specialty_id)?.name)||'Sin especialidad',color:p.color,initials:p.display_name.split(' ').map((x:string)=>x[0]).slice(0,2).join('')}));const mappedAppointments:Appointment[]=agenda.appointments.map((a:any)=>{const [start,end]=rangeDates(a.service_period);return {id:a.id,time:hhmm(start),end:hhmm(end),client:a.client?.full_name??'Cliente',professionalId:a.professional?.id,serviceName:a.service?.name??'Servicio',status:a.status}});setProfessionals(mapped);setAppointments(mappedAppointments);setLive(true)}).catch(()=>setLive(false)).finally(()=>setLoading(false))},[day,revision])
  const shown=selected==='all'?professionals:professionals.filter(p=>p.id===selected)
  return <>{showNew&&<NewAppointmentModal onClose={()=>setShowNew(false)} onCreated={()=>setRevision(v=>v+1)}/>}<PageHeader title="Agenda general" description="Todos los profesionales, cada especialidad en su propia agenda." action={<button onClick={()=>setShowNew(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Nueva reserva</button>}/>
    {!loading&&!live&&<p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Vista de demostración: conecta Supabase para cargar reservas reales.</p>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><button className="rounded-lg border bg-white p-2"><ChevronLeft size={18}/></button><button className="rounded-lg border bg-white px-4 py-2 text-sm font-bold">Hoy</button><button className="rounded-lg border bg-white p-2"><ChevronRight size={18}/></button><b className="ml-2">{new Intl.DateTimeFormat('es-CL',{weekday:'long',day:'numeric',month:'long'}).format(day.start)}</b></div><select value={selected} onChange={e=>setSelected(e.target.value)} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm"><option value="all">Todo el equipo</option>{professionals.map(p=><option value={p.id} key={p.id}>{p.name} · {p.specialty}</option>)}</select></div>
    <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm"><div className="min-w-[850px]" style={{display:'grid',gridTemplateColumns:`72px repeat(${Math.max(shown.length,1)}, minmax(150px, 1fr))`}}><div className="border-b border-r p-3"/>{shown.map(p=><div key={p.id} className="border-b border-r p-3 text-center"><span className="mx-auto mb-1 block h-2 w-10 rounded-full" style={{background:p.color}}/><b className="block text-sm">{p.name.split(' ')[0]}</b><small className="text-[#736f83]">{p.specialty}</small></div>)}{hours.map(hour=><div key={hour} className="contents"><div className="h-20 border-b border-r p-3 text-xs font-semibold text-[#736f83]">{hour}</div>{shown.map(p=><div key={`${hour}-${p.id}`} className="relative h-20 border-b border-r p-1">{appointments.filter(a=>a.time.slice(0,2)===hour.slice(0,2)&&a.professionalId===p.id).map(a=><div key={a.id} className="absolute inset-x-1 top-1 z-10 rounded-lg p-2 text-xs text-white shadow" style={{background:p.color}}><b className="block truncate">{a.time} · {a.client}</b><span className="block truncate opacity-80">{a.serviceName}</span></div>)}</div>)}</div>)}</div></div>
  </>
}
