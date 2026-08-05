'use client'
import { PageHeader } from '@/components/PageHeader'
import { FormEvent, useEffect, useState } from 'react'

type Settings = { openai_fallback_key: string | null; dashscope_fallback_key: string | null; dashscope_fallback_endpoint: string | null }

export default function PlatformKeysPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { fetch('/api/platform/settings').then(r => r.ok ? r.json() : Promise.reject()).then(d => setSettings(d.settings)).catch(() => setError('No se pudieron cargar las claves.')) }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaved(false); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/platform/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openai_fallback_key: form.get('openai') || null, dashscope_fallback_key: form.get('dashscope') || null, dashscope_fallback_endpoint: form.get('dashscopeEndpoint') || null }) })
    if (response.ok) setSaved(true); else setError('No se pudo guardar')
  }
  return <>
    <PageHeader title="Claves de plataforma" description="Respaldo usado por negocios que aún no configuraron su propia clave." />
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {settings && <form onSubmit={submit} className="max-w-xl rounded-2xl border bg-white p-5"><label className="block text-sm font-semibold">Clave OpenAI de respaldo<input name="openai" type="text" defaultValue={settings.openai_fallback_key ?? ''} placeholder="sk-…" className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" /></label><label className="mt-4 block text-sm font-semibold">Clave DashScope (voz) de respaldo<input name="dashscope" type="text" defaultValue={settings.dashscope_fallback_key ?? ''} placeholder="sk-…" className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" /></label><label className="mt-4 block text-sm font-semibold">Endpoint dedicado (solo si tu clave es de un workspace, ej. sk-ws-…)<input name="dashscopeEndpoint" type="text" defaultValue={settings.dashscope_fallback_endpoint ?? ''} className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" /></label><button className="mt-5 rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white">Guardar</button>{saved && <p className="mt-3 text-sm font-bold text-emerald-600">Guardado.</p>}</form>}
  </>
}
