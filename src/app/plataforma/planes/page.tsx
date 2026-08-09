'use client'
import { ModalShell } from '@/components/ModalShell'
import { PageHeader } from '@/components/PageHeader'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

type Plan = { id: string; code: string; name: string; max_professionals: number | null; price: number; active: boolean }
type Addon = { id: string; code: string; name: string; price: number; active: boolean }

export default function PlatformPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)

  const load = useCallback(() => {
    fetch('/api/platform/plans', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => setPlans(d.plans ?? [])).catch(() => setError('No se pudieron cargar los planes.'))
    fetch('/api/platform/addons', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => setAddons(d.addons ?? [])).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/platform/plans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: form.get('code'), name: form.get('name'), maxProfessionals: form.get('max') ? Number(form.get('max')) : null, price: Number(form.get('price') || 0) }) })
    if (response.ok) { setShow(false); load() }
  }
  async function updatePlan(plan: Plan, changes: Partial<Plan>) { await fetch('/api/platform/plans', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: plan.id, ...changes }) }); load() }
  async function updateAddon(addon: Addon, changes: Partial<Addon>) { await fetch('/api/platform/addons', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: addon.id, ...changes }) }); load() }

  return <>
    <PageHeader title="Planes y complementos" description="Precios editables que ven negocios y facturación." action={<button onClick={() => setShow(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17} />Nuevo plan</button>} />
    {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {show && <ModalShell titulo="Nuevo plan" onClose={()=>setShow(false)}><form onSubmit={createPlan} className="w-full max-w-md rounded-3xl bg-white p-6"><h2 className="text-xl font-black">Nuevo plan</h2><div className="mt-4 grid gap-3"><label className="text-sm font-semibold">Código<input name="code" required className="mt-2 w-full rounded-xl border p-3 uppercase" /></label><label className="text-sm font-semibold">Nombre<input name="name" required className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-semibold">Máximo de profesionales (vacío = ilimitado)<input name="max" type="number" min="1" className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-semibold">Precio<input name="price" type="number" min="0" defaultValue={0} className="mt-2 w-full rounded-xl border p-3" /></label></div><div className="mt-5 flex gap-2"><button type="button" onClick={() => setShow(false)} className="flex-1 rounded-xl border py-2.5 font-bold">Cancelar</button><button className="flex-1 rounded-xl bg-[#5b3df5] py-2.5 font-bold text-white">Crear</button></div></form></ModalShell>}
    <div className="rounded-2xl border bg-white p-5"><h2 className="font-extrabold">Planes</h2><div className="mt-4 space-y-3">{plans.map(plan => <div key={plan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><b>{plan.name}</b><p className="text-xs text-[#736f83]">{plan.code} · máx {plan.max_professionals ?? '∞'} profesionales</p></div><div className="flex items-center gap-3"><input type="number" defaultValue={plan.price} onBlur={e => updatePlan(plan, { price: Number(e.target.value) })} className="w-28 rounded-lg border p-2 text-sm" /><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" defaultChecked={plan.active} onChange={e => updatePlan(plan, { active: e.target.checked })} />Activo</label></div></div>)}{plans.length === 0 && <p className="py-4 text-center text-sm text-[#736f83]">Sin planes todavía.</p>}</div></div>
    <div className="mt-6 rounded-2xl border bg-white p-5"><h2 className="font-extrabold">Complementos del agente</h2><p className="text-sm text-[#736f83]">Análisis de imágenes, notas de voz y llamadas de voz — cada negocio los activa desde su configuración.</p><div className="mt-4 space-y-3">{addons.map(addon => <div key={addon.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><b>{addon.name}</b><div className="flex items-center gap-3"><input type="number" defaultValue={addon.price} onBlur={e => updateAddon(addon, { price: Number(e.target.value) })} className="w-28 rounded-lg border p-2 text-sm" /><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" defaultChecked={addon.active} onChange={e => updateAddon(addon, { active: e.target.checked })} />Disponible</label></div></div>)}</div></div>
  </>
}
