'use client'

import { PageHeader } from '@/components/PageHeader'
import { formatInZone } from '@/lib/timezone'
import { Trash2 } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useState } from 'react'

type Data = {
  pendingMigration?: boolean
  responses: Array<{ id: string; score: number; comment: string | null; created_at: string; client: { id: string; full_name: string } | null; professional: { display_name: string } | null }>
  nps: number | null
  promoters: number
  passives: number
  detractors: number
  average: number
  distribution: Array<{ score: number; count: number }>
}

export default function SurveysPage() {
  const [data, setData] = useState<Data | null>(null)
  const [clients, setClients] = useState<Array<{ id: string; full_name: string }>>([])
  const [professionals, setProfessionals] = useState<Array<{ id: string; display_name: string }>>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/surveys', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { setError(body.error ?? 'No se pudieron cargar las encuestas'); return }
      setData(body)
      setError('')
    } catch { setError('No se pudieron cargar las encuestas') }
  }, [])

  useEffect(() => {
    void load()
    fetch('/api/admin/clients').then((response) => response.json()).then((body) => setClients(body.clients ?? [])).catch(() => undefined)
    fetch('/api/admin/catalog').then((response) => response.json()).then((body) => setProfessionals(body.professionals ?? [])).catch(() => undefined)
  }, [load])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/surveys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: form.get('clientId') || null, professionalId: form.get('professionalId') || null, score: Number(form.get('score')), comment: form.get('comment') }) })
    const body = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok) { setError(body.error ?? 'No se pudo guardar la respuesta'); return }
    ;(event.target as HTMLFormElement).reset()
    void load()
  }

  async function remove(id: string) {
    if (!window.confirm('¿Eliminar esta respuesta?')) return
    const response = await fetch(`/api/admin/surveys?id=${id}`, { method: 'DELETE' })
    if (response.ok) void load()
    else setError('No se pudo eliminar')
  }

  const max = Math.max(1, ...(data?.distribution ?? []).map((row) => row.count))

  return <>
    <PageHeader title="Encuestas" description="Qué tan probable es que tus clientes te recomienden, con las respuestas del último año."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {data?.pendingMigration && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Falta aplicar la migración de encuestas en la base de datos.</p>}

    {data && !data.pendingMigration && <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">NPS</p><b className="text-3xl">{data.nps === null ? '—' : data.nps}</b><p className="text-xs text-[#736f83]">{data.responses.length} respuestas</p></article>
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Nota promedio</p><b className="text-3xl">{data.average || '—'}</b><p className="text-xs text-[#736f83]">de 0 a 10</p></article>
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Promotores</p><b className="text-3xl text-emerald-600">{data.promoters}</b><p className="text-xs text-[#736f83]">notas 9 y 10</p></article>
        <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Detractores</p><b className="text-3xl text-red-600">{data.detractors}</b><p className="text-xs text-[#736f83]">notas 0 a 6 · {data.passives} neutros</p></article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_minmax(0,380px)]">
        <article className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Distribución de notas</h2>
          <div className="mt-4 flex h-32 items-end gap-1.5">
            {data.distribution.map((row) => <div key={row.score} className="flex flex-1 flex-col items-center gap-1">
              <div className={`w-full rounded-t ${row.score >= 9 ? 'bg-emerald-500' : row.score >= 7 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ height: `${row.count / max * 100}%` }} title={`${row.count} respuestas`}/>
              <small className="text-[10px] text-[#736f83]">{row.score}</small>
            </div>)}
          </div>

          <h2 className="mt-6 font-extrabold">Respuestas</h2>
          <div className="mt-3 space-y-2">
            {data.responses.map((row) => <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-black/5 p-3">
              <div className="min-w-0">
                <b className="text-sm">{row.client?.full_name ?? 'Cliente sin registrar'}</b>
                <p className="text-xs text-[#736f83]">{row.professional?.display_name ?? 'Sin profesional'} · {formatInZone(new Date(row.created_at), 'America/Santiago', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                {row.comment && <p className="mt-1 text-sm text-[#4b4761]">{row.comment}</p>}
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-sm font-bold ${row.score >= 9 ? 'bg-emerald-50 text-emerald-700' : row.score >= 7 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>{row.score}</span>
                <button aria-label="Eliminar respuesta" onClick={() => void remove(row.id)} className="rounded-lg border border-red-200 p-1.5 text-red-700"><Trash2 size={14}/></button>
              </div>
            </div>)}
            {data.responses.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Todavía no hay respuestas registradas.</p>}
          </div>
        </article>

        <form onSubmit={submit} className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Registrar una respuesta</h2>
          <p className="mt-1 text-sm text-[#736f83]">Cuando un cliente te dice su nota por teléfono o en el local.</p>
          <label className="mt-4 block text-sm font-semibold">Cliente<select name="clientId" className="mt-2 w-full rounded-xl border p-3"><option value="">Sin identificar</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.full_name}</option>)}</select></label>
          <label className="mt-4 block text-sm font-semibold">Profesional<select name="professionalId" className="mt-2 w-full rounded-xl border p-3"><option value="">Sin profesional</option>{professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.display_name}</option>)}</select></label>
          <label className="mt-4 block text-sm font-semibold">Nota (0 a 10)<input name="score" type="number" min="0" max="10" required className="mt-2 w-full rounded-xl border p-3"/></label>
          <label className="mt-4 block text-sm font-semibold">Comentario<textarea name="comment" rows={3} className="mt-2 w-full rounded-xl border p-3"/></label>
          <button disabled={saving} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar respuesta'}</button>
        </form>
      </section>
    </>}
  </>
}
