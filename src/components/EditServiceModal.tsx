'use client'

import { FormEvent, useEffect, useState } from 'react'
import { X } from 'lucide-react'

type Service = {
  id: string
  name: string
  description?: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  price: number
  material_cost: number
  deposit_amount: number
  active: boolean
  professional_services?: Array<{ professional_id: string }>
}

export function EditServiceModal({ service, onClose, onSaved }: { service: Service; onClose: () => void; onSaved: () => void }) {
  const [professionals, setProfessionals] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [ready, setReady] = useState(false)

  useEffect(() => { fetch('/api/admin/catalog').then((response) => response.json()).then((data) => { setProfessionals(data.professionals ?? []); setReady(true) }).catch(() => setError('No se pudo cargar el equipo')) }, [])

  const current = (service.professional_services ?? []).map((row) => row.professional_id)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/services', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: service.id,
        changes: {
          name: form.get('name'),
          description: form.get('description'),
          duration_minutes: Number(form.get('duration') || 0),
          buffer_before_minutes: Number(form.get('bufferBefore') || 0),
          buffer_after_minutes: Number(form.get('bufferAfter') || 0),
          price: Number(form.get('price') || 0),
          material_cost: Number(form.get('materialCost') || 0),
          deposit_amount: Number(form.get('deposit') || 0),
        },
        // Igual que en el profesional: sin catálogo cargado no se toca la lista autorizada.
        ...(ready ? { professionalIds: form.getAll('professionalIds') } : {}),
      }),
    })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo guardar'); return }
    setMessage('Cambios guardados.')
    onSaved()
  }

  async function toggleActive() {
    setLoading(true); setError(''); setMessage('')
    const response = service.active
      ? await fetch(`/api/admin/services?id=${service.id}`, { method: 'DELETE' })
      : await fetch('/api/admin/services', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: service.id, changes: { active: true } }) })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo cambiar el estado'); return }
    onSaved()
    onClose()
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">Editar servicio</h2><p className="text-sm text-[#736f83]">{service.name}</p></div>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X/></button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold sm:col-span-2">Nombre<input name="name" defaultValue={service.name} required className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Duración (min)<input name="duration" type="number" min="5" max="1440" defaultValue={service.duration_minutes} required className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Precio<input name="price" type="number" min="0" step="1" defaultValue={service.price} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Costo de materiales<input name="materialCost" type="number" min="0" step="1" defaultValue={service.material_cost} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Anticipo<input name="deposit" type="number" min="0" step="1" defaultValue={service.deposit_amount} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Preparación antes (min)<input name="bufferBefore" type="number" min="0" max="240" defaultValue={service.buffer_before_minutes} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Limpieza después (min)<input name="bufferAfter" type="number" min="0" max="240" defaultValue={service.buffer_after_minutes} className="mt-2 w-full rounded-xl border p-3"/></label>
      </div>
      <label className="mt-4 block text-sm font-semibold">Descripción<textarea name="description" defaultValue={service.description ?? ''} rows={3} className="mt-2 w-full rounded-xl border p-3"/></label>
      <fieldset className="mt-4"><legend className="text-sm font-semibold">Profesionales autorizados</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{professionals.map((professional) => <label key={professional.id} className="rounded-lg border p-2 text-sm"><input className="mr-2" type="checkbox" name="professionalIds" value={professional.id} defaultChecked={current.includes(professional.id)}/>{professional.display_name}</label>)}</div><small className="mt-2 block text-xs text-[#736f83]">Solo estos profesionales se ofrecen para este servicio, en el portal y en el agente.</small></fieldset>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
      <button disabled={loading || !ready} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Guardando…' : ready ? 'Guardar cambios' : 'Cargando datos…'}</button>
      <button type="button" disabled={loading} onClick={() => void toggleActive()} className={`mt-3 w-full rounded-xl border py-3 font-bold disabled:opacity-50 ${service.active ? 'border-red-200 text-red-700' : 'border-emerald-200 text-emerald-700'}`}>{service.active ? 'Desactivar servicio' : 'Reactivar servicio'}</button>
    </form>
  </div>
}
