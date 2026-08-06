'use client'

import { FormEvent, useEffect, useState } from 'react'
import { X } from 'lucide-react'

type Professional = {
  id: string
  display_name: string
  phone?: string | null
  bio?: string | null
  color: string
  commission_percent: number
  branch_id?: string | null
  active: boolean
  professional_specialties?: Array<{ specialty_id: string }>
  professional_services?: Array<{ service_id: string }>
}

export function EditProfessionalModal({ professional, onClose, onSaved }: { professional: Professional; onClose: () => void; onSaved: () => void }) {
  const [catalog, setCatalog] = useState<{ branches: any[]; specialties: any[]; services: any[] }>({ branches: [], specialties: [], services: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [ready, setReady] = useState(false)

  useEffect(() => { fetch('/api/admin/catalog').then((response) => response.json()).then((data) => { setCatalog(data); setReady(true) }).catch(() => setError('No se pudo cargar el catálogo')) }, [])

  const currentSpecialties = (professional.professional_specialties ?? []).map((row) => row.specialty_id)
  const currentServices = (professional.professional_services ?? []).map((row) => row.service_id)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError(''); setMessage('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/professionals', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: professional.id,
        changes: {
          display_name: form.get('displayName'),
          phone: form.get('phone'),
          bio: form.get('bio'),
          color: form.get('color'),
          commission_percent: Number(form.get('commission') || 0),
          branch_id: form.get('branchId') || null,
        },
        // Solo se reemplazan las listas cuando el catálogo llegó: si no, se borrarían las asignaciones actuales.
        ...(ready ? { specialtyIds: form.getAll('specialtyIds'), serviceIds: form.getAll('serviceIds') } : {}),
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
    const response = professional.active
      ? await fetch(`/api/admin/professionals?id=${professional.id}`, { method: 'DELETE' })
      : await fetch('/api/admin/professionals', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: professional.id, changes: { active: true } }) })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo cambiar el estado'); return }
    onSaved()
    onClose()
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">Editar profesional</h2><p className="text-sm text-[#736f83]">{professional.display_name}</p></div>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X/></button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Nombre<input name="displayName" defaultValue={professional.display_name} required className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Teléfono del equipo<input name="phone" type="tel" defaultValue={professional.phone ?? ''} placeholder="+56 9 1234 5678" className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Sucursal<select name="branchId" defaultValue={professional.branch_id ?? ''} className="mt-2 w-full rounded-xl border p-3"><option value="">Sin sucursal fija</option>{catalog.branches.map((branch: any) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Color<input name="color" type="color" defaultValue={professional.color} className="mt-2 h-12 w-full rounded-xl border p-2"/></label>
        <label className="text-sm font-semibold">Comisión (%)<input name="commission" type="number" min="0" max="100" step="0.1" defaultValue={professional.commission_percent} className="mt-2 w-full rounded-xl border p-3"/></label>
      </div>
      <label className="mt-4 block text-sm font-semibold">Presentación<textarea name="bio" defaultValue={professional.bio ?? ''} rows={3} className="mt-2 w-full rounded-xl border p-3"/></label>
      <fieldset className="mt-4"><legend className="text-sm font-semibold">Especialidades</legend><div className="mt-2 flex flex-wrap gap-2">{catalog.specialties.map((specialty: any) => <label key={specialty.id} className="rounded-lg border p-2 text-sm"><input className="mr-2" type="checkbox" name="specialtyIds" value={specialty.id} defaultChecked={currentSpecialties.includes(specialty.id)}/>{specialty.name}</label>)}</div></fieldset>
      <fieldset className="mt-4"><legend className="text-sm font-semibold">Servicios habilitados</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{catalog.services.map((service: any) => <label key={service.id} className="rounded-lg border p-2 text-sm"><input className="mr-2" type="checkbox" name="serviceIds" value={service.id} defaultChecked={currentServices.includes(service.id)}/>{service.name}</label>)}</div></fieldset>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
      <button disabled={loading || !ready} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Guardando…' : ready ? 'Guardar cambios' : 'Cargando datos…'}</button>
      <button type="button" disabled={loading} onClick={() => void toggleActive()} className={`mt-3 w-full rounded-xl border py-3 font-bold disabled:opacity-50 ${professional.active ? 'border-red-200 text-red-700' : 'border-emerald-200 text-emerald-700'}`}>{professional.active ? 'Desactivar profesional' : 'Reactivar profesional'}</button>
      <p className="mt-2 text-xs text-[#736f83]">Desactivar no borra su historial: deja de aparecer en los cupos, en el portal del cliente y en el agente.</p>
    </form>
  </div>
}
