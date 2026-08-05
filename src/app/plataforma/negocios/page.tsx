'use client'
import { PageHeader } from '@/components/PageHeader'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Plus, ShieldOff, ShieldCheck, Trash2, X } from 'lucide-react'

type Business = { id: string; name: string; slug: string; active: boolean; suspended_at: string | null; created_at: string; timezone: string; currency: string; whatsapp_provider: string | null; membership_plans: { code: string; name: string; price: number } | null }
type Plan = { id: string; code: string; name: string }

function NewBusinessModal({ plans, onClose, onCreated }: { plans: Plan[]; onClose: () => void; onCreated: (inviteLink: string | null) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/platform/businesses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), slug: form.get('slug'), timezone: form.get('timezone'), currency: form.get('currency'), planId: form.get('planId') || null, ownerEmail: form.get('ownerEmail') }) })
    const data = await response.json()
    if (!response.ok) { setError(data.error ?? 'No se pudo crear'); setLoading(false); return }
    onCreated(data.inviteLink ?? null)
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form onSubmit={submit} className="w-full max-w-lg rounded-3xl bg-white p-6"><div className="flex justify-between"><h2 className="text-xl font-black">Nuevo negocio</h2><button aria-label="Cerrar" type="button" onClick={onClose}><X /></button></div><div className="mt-5 grid gap-4"><label className="text-sm font-semibold">Nombre<input name="name" required className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-semibold">Slug<input name="slug" required pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$" placeholder="centro-estetico-x" className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-semibold">Correo del dueño<input name="ownerEmail" type="email" required className="mt-2 w-full rounded-xl border p-3" /></label><div className="grid grid-cols-2 gap-4"><label className="text-sm font-semibold">Zona horaria<input name="timezone" defaultValue="America/Santiago" className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-semibold">Moneda<input name="currency" defaultValue="CLP" maxLength={3} className="mt-2 w-full rounded-xl border p-3 uppercase" /></label></div><label className="text-sm font-semibold">Plan<select name="planId" className="mt-2 w-full rounded-xl border p-3"><option value="">Sin plan</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label></div>{error && <p className="mt-3 text-sm text-red-600">{error}</p>}<button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Creando…' : 'Crear negocio'}</button></form></div>
}

function DeleteBusinessModal({ business, onClose, onDeleted }: { business: Business; onClose: () => void; onDeleted: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function confirm() {
    setLoading(true); setError('')
    const response = await fetch(`/api/platform/businesses/${business.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: value }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { setError(data.error ?? 'No se pudo eliminar'); setLoading(false); return }
    onDeleted()
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6"><h2 className="text-xl font-black text-red-700">Eliminar {business.name}</h2><p className="mt-2 text-sm text-[#736f83]">Esto borra en cascada todos sus datos (agenda, clientes, campañas…) y las cuentas que no pertenezcan a otro negocio. Escribe exactamente <b>{business.name}</b> para confirmar.</p><input value={value} onChange={e => setValue(e.target.value)} className="mt-4 w-full rounded-xl border p-3" />{error && <p className="mt-2 text-sm text-red-600">{error}</p>}<div className="mt-5 flex gap-2"><button onClick={onClose} className="flex-1 rounded-xl border py-2.5 font-bold">Cancelar</button><button onClick={confirm} disabled={loading || value !== business.name} className="flex-1 rounded-xl bg-red-600 py-2.5 font-bold text-white disabled:opacity-40">{loading ? 'Eliminando…' : 'Eliminar definitivamente'}</button></div></div></div>
}

export default function PlatformBusinessesPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Business | null>(null)

  const load = useCallback(() => {
    fetch('/api/platform/businesses', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => setBusinesses(d.businesses ?? [])).catch(() => setError('No se pudieron cargar los negocios.'))
    fetch('/api/platform/plans', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(d => setPlans(d.plans ?? [])).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])

  async function toggleSuspend(business: Business) {
    await fetch(`/api/platform/businesses/${business.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suspended: !business.suspended_at }) })
    load()
  }

  return <>
    {show && <NewBusinessModal plans={plans} onClose={() => setShow(false)} onCreated={(link) => { setShow(false); setInvite(link); load() }} />}
    {deleting && <DeleteBusinessModal business={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); load() }} />}
    {invite && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-3xl bg-white p-6"><h2 className="text-xl font-black">Negocio creado</h2><p className="mt-2 text-sm text-[#736f83]">Copia este enlace de invitación y envíalo al dueño (expira, es de un solo uso):</p><input readOnly value={invite} className="mt-3 w-full rounded-xl border bg-[#f7f6fa] p-3 text-xs" onFocus={e => e.target.select()} /><button onClick={() => setInvite(null)} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white">Listo</button></div></div>}
    <PageHeader title="Negocios" description="Todos los tenants del SaaS Agen." action={<button onClick={() => setShow(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17} />Nuevo negocio</button>} />
    {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[#f7f6fa] text-xs uppercase text-[#736f83]"><tr><th className="p-3">Negocio</th><th>Plan</th><th>Canal</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead><tbody>{businesses.map(business => <tr key={business.id} className="border-t"><td className="p-3"><b>{business.name}</b><p className="text-xs text-[#736f83]">{business.slug}</p></td><td>{business.membership_plans?.name ?? 'Sin plan'}</td><td>{business.whatsapp_provider ?? '—'}</td><td>{business.suspended_at ? <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">Suspendido</span> : <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">Activo</span>}</td><td className="p-3 text-right"><div className="inline-flex gap-2"><button title={business.suspended_at ? 'Reactivar' : 'Suspender'} onClick={() => toggleSuspend(business)} className="rounded-lg border p-2">{business.suspended_at ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}</button><button title="Eliminar" onClick={() => setDeleting(business)} className="rounded-lg border border-red-200 p-2 text-red-600"><Trash2 size={16} /></button></div></td></tr>)}{businesses.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-sm text-[#736f83]">Aún no hay negocios.</td></tr>}</tbody></table></div>
  </>
}
