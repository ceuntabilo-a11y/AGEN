'use client'

import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { money } from '@/lib/demo-data'
import { formatTimeInZone } from '@/lib/timezone'
import { CalendarCheck2, CircleDollarSign, Clock3, UserRoundCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

type DashboardData = {
  appointments: Array<any>
  revenue: number
  newClients: number
  activeProfessionals: number
  timezone: string
  currency: string
}

const rangeStart = (range: string) => new Date(range.replace(/[\[\]()"]/g, '').split(',')[0])

export default function AdminOverview() {
  const [data, setData] = useState<DashboardData>({ appointments: [], revenue: 0, newClients: 0, activeProfessionals: 0, timezone: 'America/Santiago', currency: 'CLP' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then(async (response) => {
        if (!response.ok) throw new Error()
        return response.json()
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return <>
    <PageHeader title="Resumen del negocio" description="Actividad, reservas y resultados de hoy." action={<a href="/admin/agenda" className="rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white">Abrir agenda</a>}/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para ver datos reales. No se muestran cifras inventadas.</p>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Reservas de hoy" value={loading ? '…' : String(data.appointments.length)} detail={`${data.appointments.filter((appointment) => appointment.status === 'CONFIRMED').length} confirmadas`} icon={CalendarCheck2}/>
      <StatCard label="Ingresos de hoy" value={loading ? '…' : money(data.revenue, data.currency)} detail="Pagos confirmados" icon={CircleDollarSign} tone="#17b890"/>
      <StatCard label="Profesionales activos" value={loading ? '…' : String(data.activeProfessionals)} detail="Equipo disponible" icon={Clock3} tone="#ff9f43"/>
      <StatCard label="Clientes nuevos" value={loading ? '…' : String(data.newClients)} detail="Registrados hoy" icon={UserRoundCheck} tone="#ff6f91"/>
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_.6fr]">
      <article className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between"><h2 className="font-extrabold">Próximas reservas</h2><a href="/admin/agenda" className="text-sm font-semibold text-[#5b3df5]">Ver todas</a></div>
        <div className="space-y-2">
          {data.appointments.slice(0, 6).map((appointment) => {
            const start = rangeStart(appointment.service_period)
            return <div key={appointment.id} className="flex items-center gap-4 rounded-xl border border-black/5 p-3">
              <span className="h-10 w-1 rounded-full" style={{ background: appointment.professional?.color ?? '#5b3df5' }}/>
              <b className="w-12 text-sm">{formatTimeInZone(start, data.timezone)}</b>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{appointment.client?.full_name ?? 'Cliente'}</p><p className="truncate text-xs text-[#736f83]">{appointment.service?.name} · {appointment.professional?.display_name}</p></div>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{appointment.status}</span>
            </div>
          })}
          {!loading && data.appointments.length === 0 && <p className="py-8 text-center text-sm text-[#736f83]">No hay reservas para hoy.</p>}
        </div>
      </article>
      <article className="rounded-2xl bg-[#19162b] p-5 text-white shadow-sm">
        <p className="text-sm text-white/55">Agente IA</p><h2 className="mt-1 text-xl font-extrabold">Protección activa</h2>
        <div className="mt-7 space-y-3 text-sm text-white/65"><p>✓ Filtra por servicio y especialidad</p><p>✓ Revalida cada horario</p><p>✓ Bloquea reservas simultáneas</p><p>✓ Recuerda datos ya conocidos</p></div>
      </article>
    </section>
  </>
}
