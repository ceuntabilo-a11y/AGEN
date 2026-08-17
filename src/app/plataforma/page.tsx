'use client'
import { PageHeader } from '@/components/PageHeader'
import { Activity, Building2, CircleDollarSign, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'

type Overview = { businesses: { total: number; active: number; suspended: number }; professionals: number; appointments: number; mrr: number; health: { supabase: boolean; n8n: boolean | null } }

export default function PlatformOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { fetch('/api/platform/overview').then(async r => { if (!r.ok) throw new Error(); return r.json() }).then(setData).catch(() => setError('No se pudo cargar el resumen de plataforma.')) }, [])
  const money = (value: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value)
  return <>
    <PageHeader title="Resumen de plataforma" description="Salud y negocio del SaaS Agen, a nivel de dueño de plataforma." />
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {data && <div className="grid gap-4 md:grid-cols-4">
      <article className="rounded-2xl border bg-white p-5"><Building2 className="text-[#5b3df5]" /><p className="mt-4 text-sm text-[#736f83]">Negocios activos</p><b className="text-3xl">{data.businesses.active}</b><p className="mt-1 text-xs text-[#736f83]">{data.businesses.total} total · {data.businesses.suspended} suspendidos</p></article>
      <article className="rounded-2xl border bg-white p-5"><UsersRound className="text-[#5b3df5]" /><p className="mt-4 text-sm text-[#736f83]">Profesionales activos</p><b className="text-3xl">{data.professionals}</b></article>
      <article className="rounded-2xl border bg-white p-5"><CircleDollarSign className="text-[#5b3df5]" /><p className="mt-4 text-sm text-[#736f83]">MRR estimado</p><b className="text-3xl">{money(data.mrr)}</b></article>
      <article className="rounded-2xl border bg-white p-5"><Activity className="text-[#5b3df5]" /><p className="mt-4 text-sm text-[#736f83]">Salud</p><div className="mt-2 space-y-1 text-sm"><p>Supabase: <b className={data.health.supabase ? 'text-emerald-600' : 'text-red-600'}>{data.health.supabase ? 'En línea' : 'Caído'}</b></p><p>n8n: <b className={data.health.n8n === false ? 'text-red-600' : data.health.n8n === true ? 'text-emerald-600' : 'text-[#736f83]'}>{data.health.n8n === null ? 'No configurado' : data.health.n8n ? 'En línea' : 'Caído'}</b></p></div></article>
    </div>}
  </>
}
