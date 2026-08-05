'use client'
import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

type Health = { supabase: boolean; n8n: boolean | null }

export default function PlatformMonitorPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [checking, setChecking] = useState(false)
  const load = useCallback(() => { setChecking(true); fetch('/api/platform/overview', { cache: 'no-store' }).then(r => r.json()).then(d => setHealth(d.health)).finally(() => setChecking(false)) }, [])
  useEffect(() => { load(); const timer = window.setInterval(load, 30000); return () => window.clearInterval(timer) }, [load])
  return <>
    <PageHeader title="Monitor" description="Salud de los servicios de los que depende Agen." action={<button onClick={load} disabled={checking} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50"><RefreshCw size={16} className={checking ? 'animate-spin' : ''} />Re-verificar</button>} />
    <div className="grid gap-4 md:grid-cols-2">
      <article className="rounded-2xl border bg-white p-5"><b>Supabase</b><p className="mt-2 text-sm text-[#736f83]">Base de datos y autenticación.</p><span className={`mt-4 inline-block rounded-full px-3 py-1 text-sm font-bold ${health?.supabase ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{health ? (health.supabase ? 'En línea' : 'Caído') : 'Verificando…'}</span></article>
      <article className="rounded-2xl border bg-white p-5"><b>n8n</b><p className="mt-2 text-sm text-[#736f83]">Agente conversacional, recordatorios y campañas.</p><span className={`mt-4 inline-block rounded-full px-3 py-1 text-sm font-bold ${health?.n8n === false ? 'bg-red-50 text-red-700' : health?.n8n === true ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{!health ? 'Verificando…' : health.n8n === null ? 'Sin URL configurada (N8N_WEBHOOK_URL)' : health.n8n ? 'En línea' : 'Caído'}</span></article>
    </div>
  </>
}
