'use client'

import { PageHeader } from '@/components/PageHeader'
import { money } from '@/lib/demo-data'
import { formatInZone } from '@/lib/timezone'
import { useEffect, useState } from 'react'

type Data = { professional:{commission_percent:number}|null; appointments:Array<any>; commission:number; timezone:string; currency:string }
const rangeStart = (range:string) => new Date(range.replace(/[\[\]()"]/g,'').split(',')[0])

export default function ProfessionalIncome() {
  const [data,setData] = useState<Data>({ professional:null, appointments:[], commission:0, timezone:'America/Santiago', currency:'CLP' })
  const [error,setError] = useState(false)

  useEffect(() => {
    fetch('/api/professional/income').then(async (response) => {
      if (!response.ok) throw new Error()
      return response.json()
    }).then(setData).catch(() => setError(true))
  },[])

  return <>
    <PageHeader title="Mis ingresos" description="Servicios completados y comisiones transparentes."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para calcular tus ingresos.</p>}
    <div className="rounded-2xl bg-[#19162b] p-6 text-white">
      <p className="text-white/60">Comisión acumulada este mes</p><b className="mt-2 block text-4xl">{money(data.commission,data.currency)}</b>
      <p className="mt-2 text-sm text-white/50">{data.professional?.commission_percent ?? 0}% · {data.appointments.length} servicios completados</p>
    </div>
    <div className="mt-5 space-y-2">
      {data.appointments.map((appointment) => <div key={appointment.id} className="flex flex-wrap justify-between gap-2 rounded-xl border bg-white p-4">
        <span>{appointment.service?.name ?? 'Servicio'}<small className="ml-2 text-[#736f83]">{formatInZone(rangeStart(appointment.service_period),data.timezone,{dateStyle:'medium'})}</small></span>
        <b>{money(Number(appointment.quoted_price) * Number(data.professional?.commission_percent ?? 0) / 100,data.currency)}</b>
      </div>)}
    </div>
  </>
}
