'use client'

import { FormEvent, useEffect, useState } from 'react'
import { dateKeyInZone } from '@/lib/timezone'
import { ModalShell } from '@/components/ModalShell'

const CATEGORIES = ['Insumos', 'Arriendo', 'Sueldos', 'Servicios básicos', 'Marketing', 'Equipamiento', 'Otro']

export function NewExpenseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [professionals, setProfessionals] = useState<Array<{ id: string; display_name: string }>>([])
  const [today, setToday] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetch('/api/admin/catalog').then((response) => response.json()).then((data) => {
    setProfessionals(data.professionals ?? [])
    // "Hoy" es el del negocio, no el del navegador ni el del servidor.
    setToday(dateKeyInZone(new Date(), data.business?.timezone ?? 'America/Santiago'))
  }).catch(() => undefined) }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/expenses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: form.get('category'), description: form.get('description'), amount: Number(form.get('amount') || 0), incurredOn: form.get('incurredOn'), professionalId: form.get('professionalId') || null }),
    })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo registrar el gasto'); return }
    onCreated()
    onClose()
  }

  return <ModalShell titulo="Registrar gasto" onClose={onClose}>
    <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">Registrar gasto</h2><p className="text-sm text-[#736f83]">Se descuenta del resultado del mes.</p></div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Categoría<select name="category" className="mt-2 w-full rounded-xl border p-3">{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label className="text-sm font-semibold">Monto<input name="amount" type="number" min="1" step="1" required className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Fecha<input key={today} name="incurredOn" type="date" defaultValue={today} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Profesional (opcional)<select name="professionalId" className="mt-2 w-full rounded-xl border p-3"><option value="">Del negocio</option>{professionals.map((professional) => <option key={professional.id} value={professional.id}>{professional.display_name}</option>)}</select></label>
      </div>
      <label className="mt-4 block text-sm font-semibold">Descripción<input name="description" required placeholder="Compra de tintes" className="mt-2 w-full rounded-xl border p-3"/></label>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Guardando…' : 'Registrar gasto'}</button>
    </form>
  </ModalShell>
}
