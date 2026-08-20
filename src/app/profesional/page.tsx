'use client'

import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { money } from '@/lib/money'
import { mensajeDeFallo } from '@/lib/api-fetch-error'
import { formatTimeInZone } from '@/lib/timezone'
import { CalendarCheck2, CircleDollarSign, Clock3 } from 'lucide-react'
import { useEffect, useState } from 'react'

type Data = { professional:{display_name:string}|null; appointments:Array<any>; commission:number; timezone:string; currency:string }
const start = (range:string) => new Date(range.replace(/[\[\]()"]/g,'').split(',')[0])

export default function ProfessionalPage() {
  const [data,setData] = useState<Data>({ professional:null, appointments:[], commission:0, timezone:'America/Santiago', currency:'CLP' })
  const [error,setError] = useState('')

  useEffect(() => {
    fetch('/api/professional/dashboard').then(async (response) => {
      if (!response.ok) { setError(mensajeDeFallo(response.status, 'cargar tu día')); return null }
      return response.json()
    }).then((value) => { if (value) { setData(value); setError('') } }).catch(() => setError(mensajeDeFallo(null, 'cargar tu día')))
  },[])

  return <>
    <PageHeader title={data.professional ? `Hola, ${data.professional.display_name.split(' ')[0]}` : 'Mi día'} description="Tu jornada y resultados de hoy."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Reservas" value={String(data.appointments.length)} detail="Agenda de hoy" icon={CalendarCheck2}/>
      <StatCard label="Completadas" value={String(data.appointments.filter((appointment) => appointment.status === 'COMPLETED').length)} detail="Atenciones finalizadas" icon={Clock3} tone="#ff9f43"/>
      <StatCard label="Comisión de hoy" value={money(data.commission,data.currency)} detail="Según servicios completados" icon={CircleDollarSign} tone="#17b890"/>
    </div>
    <section className="mt-6 rounded-2xl border bg-white p-5">
      <h2 className="font-extrabold">Tu agenda</h2>
      <div className="mt-4 space-y-3">
        {data.appointments.map((appointment) => <div key={appointment.id} className="flex items-center gap-4 rounded-xl bg-[#f7f6fa] p-4">
          <b>{formatTimeInZone(start(appointment.service_period),data.timezone)}</b>
          <div className="flex-1"><b className="text-sm">{appointment.client?.full_name ?? 'Cliente'}</b><p className="text-xs text-[#736f83]">{appointment.service?.name}</p></div>
          <span className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-[#5b3df5]">{appointment.status}</span>
        </div>)}
        {!error && data.appointments.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">No tienes reservas hoy.</p>}
      </div>
    </section>
  </>
}
