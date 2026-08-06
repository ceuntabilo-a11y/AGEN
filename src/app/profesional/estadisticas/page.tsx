'use client'

import { PageHeader } from '@/components/PageHeader'
import { money } from '@/lib/money'
import { useEffect, useState } from 'react'

type Stats = {
  total: number; completed: number; noShow: number; cancelled: number; completionRate: number; revenue: number
  services: Array<{ name: string; count: number; revenue: number }>
  hours: Array<{ hour: number; count: number }>
  weekdays: Array<{ weekday: number; count: number }>
  currency: string
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export default function ProfessionalStatsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/professional/stats', { cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() })
      .then(setStats)
      .catch(() => setError(true))
  }, [])

  const maxHour = Math.max(1, ...(stats?.hours ?? []).map((row) => row.count))
  const maxService = Math.max(1, ...(stats?.services ?? []).map((row) => row.count))

  return <>
    <PageHeader title="Mis estadísticas" description="Tus últimos 90 días: qué haces más, cuándo te buscan y cómo terminan tus reservas."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para ver tus estadísticas.</p>}
    {!stats && !error && <p className="text-sm text-[#736f83]">Cargando…</p>}

    {stats && <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Reservas</p><b className="text-2xl">{stats.total}</b></article>
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Completadas</p><b className="text-2xl text-emerald-600">{stats.completed}</b><p className="text-xs text-[#736f83]">{stats.completionRate}% del total</p></article>
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">No asistió</p><b className="text-2xl text-red-600">{stats.noShow}</b><p className="text-xs text-[#736f83]">{stats.cancelled} canceladas</p></article>
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Facturado</p><b className="text-2xl">{money(stats.revenue, stats.currency)}</b><p className="text-xs text-[#736f83]">Servicios completados</p></article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <article className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Lo que más haces</h2>
          <div className="mt-4 space-y-3">
            {stats.services.map((service) => <div key={service.name}>
              <div className="flex items-center justify-between text-sm"><b>{service.name}</b><span className="text-[#736f83]">{service.count}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#eceaf4]"><div className="h-full rounded-full bg-[#5b3df5]" style={{ width: `${service.count / maxService * 100}%` }}/></div>
            </div>)}
            {stats.services.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Todavía no tienes reservas en este período.</p>}
          </div>
        </article>

        <article className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Horas en que te buscan</h2>
          <div className="mt-4 flex h-40 items-end gap-1">
            {stats.hours.map((row) => <div key={row.hour} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-t bg-[#5b3df5]" style={{ height: `${row.count / maxHour * 100}%` }} title={`${row.count} reservas`}/>
              <small className="text-[10px] text-[#736f83]">{String(row.hour).padStart(2, '0')}</small>
            </div>)}
            {stats.hours.length === 0 && <p className="w-full text-center text-sm text-[#736f83]">Sin datos todavía.</p>}
          </div>
          <div className="mt-5 space-y-1 text-sm">
            {stats.weekdays.map((row) => <p key={row.weekday} className="flex justify-between"><span>{DAYS[row.weekday]}</span><b>{row.count}</b></p>)}
          </div>
        </article>
      </section>
    </>}
  </>
}
