'use client'

import { PageHeader } from '@/components/PageHeader'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'
import { CalendarDays, Clock3, MapPin, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Appointment = { id:string; status:string; service_period:string; professional:{display_name:string}|null; service:{name:string}|null; branch:{name:string;address:string}|null }
const start = (value:string) => new Date(value.replace(/[\[\]()"]/g,'').split(',')[0])

export default function ClientHome() {
  const [next,setNext] = useState<Appointment|null>(null)
  const [timezone,setTimezone] = useState('America/Santiago')
  const [settings,setSettings] = useState<Record<string,any>>({})
  const [error,setError] = useState(false)

  useEffect(() => {
    fetch('/api/client/appointments').then(async (response) => {
      if (!response.ok) throw new Error()
      return response.json()
    }).then((data) => {
      const upcoming = (data.appointments ?? []).filter((appointment:Appointment) => !['CANCELLED','COMPLETED','NO_SHOW'].includes(appointment.status) && start(appointment.service_period) > new Date()).sort((a:Appointment,b:Appointment) => start(a.service_period).getTime() - start(b.service_period).getTime())
      setNext(upcoming[0] ?? null)
      setTimezone(data.timezone ?? 'America/Santiago')
      setSettings(data.settings ?? {})
    }).catch(() => setError(true))
  },[])

  const brand = typeof settings.brand_color === 'string' ? settings.brand_color : '#5b3df5'
  const welcome = typeof settings.portal?.welcome === 'string' ? settings.portal.welcome.trim() : ''

  return <>
    <PageHeader title="Mi espacio" description={welcome || 'Reservas y servicios en un solo lugar.'}/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para cargar tus datos.</p>}
    {next ? <section className="rounded-3xl p-6 text-white" style={{background:`linear-gradient(135deg, ${brand}, ${brand}cc)`}}>
      <p className="text-sm text-white/70">Próxima reserva</p><h2 className="mt-2 text-2xl font-black">{next.service?.name}</h2><p className="mt-1">con {next.professional?.display_name}</p>
      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <span className="flex gap-2"><CalendarDays size={18}/>{formatInZone(start(next.service_period),timezone,{dateStyle:'long'})}</span>
        <span className="flex gap-2"><Clock3 size={18}/>{formatTimeInZone(start(next.service_period),timezone)}</span>
        <span className="flex gap-2"><MapPin size={18}/>{next.branch?.name}</span>
      </div>
    </section> : <section className="rounded-3xl border bg-white p-6"><h2 className="text-xl font-black">No tienes reservas próximas</h2><p className="mt-1 text-sm text-[#736f83]">Encuentra un servicio y horario disponible.</p></section>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Link href="/cliente/reservar" className="rounded-2xl border bg-white p-5"><Sparkles className="text-[#5b3df5]"/><b className="mt-4 block">Reservar un servicio</b><p className="mt-1 text-sm text-[#736f83]">Elige especialidad, servicio y profesional.</p></Link>
      <Link href="/cliente/reservas" className="rounded-2xl border bg-white p-5"><CalendarDays className="text-[#5b3df5]"/><b className="mt-4 block">Mis reservas</b><p className="mt-1 text-sm text-[#736f83]">Revisa, reagenda o cancela según la política.</p></Link>
    </div>
  </>
}
