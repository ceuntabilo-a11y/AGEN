'use client'
import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

type Health = { supabase: boolean; n8n: boolean | null }

export default function PlatformMonitorPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [failure, setFailure] = useState('')
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    setChecking(true)
    try {
      const response = await fetch('/api/platform/overview', { cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as { health?: Health; error?: string }
      if (!response.ok || !data.health) {
        setFailure(response.status === 401 || response.status === 403
          ? 'Tu sesión expiró. Vuelve a iniciar sesión para verificar los servicios.'
          : data.error ?? `No se pudo verificar el estado de los servicios (error ${response.status}).`)
        return
      }
      setHealth(data.health)
      setFailure('')
    } catch {
      setFailure('No se pudo contactar al servidor de Agen. Revisa tu conexión.')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30000); return () => window.clearInterval(timer) }, [load])

  const label = (value: boolean | null | undefined) => {
    if (!health) return failure ? 'Sin datos' : 'Verificando…'
    return value ? 'En línea' : 'Caído'
  }

  return <>
    <PageHeader title="Monitor" description="Salud de los servicios de los que depende Agen." action={<button onClick={() => void load()} disabled={checking} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50"><RefreshCw size={16} className={checking ? 'animate-spin' : ''} />Re-verificar</button>} />
    {failure && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{failure}{health && ' Se muestra la última verificación correcta.'}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <article className="rounded-2xl border bg-white p-5"><b>Supabase</b><p className="mt-2 text-sm text-[#736f83]">Base de datos y autenticación.</p><span className={`mt-4 inline-block rounded-full px-3 py-1 text-sm font-bold ${!health ? 'bg-amber-50 text-amber-800' : health.supabase ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{label(health?.supabase)}</span></article>
      <article className="rounded-2xl border bg-white p-5"><b>n8n</b><p className="mt-2 text-sm text-[#736f83]">Agente conversacional, recordatorios y campañas.</p><span className={`mt-4 inline-block rounded-full px-3 py-1 text-sm font-bold ${health?.n8n === false ? 'bg-red-50 text-red-700' : health?.n8n === true ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{!health ? label(null) : health.n8n === null ? 'Sin URL configurada (N8N_API_URL)' : health.n8n ? 'En línea' : 'Caído'}</span></article>
    </div>
  </>
}
