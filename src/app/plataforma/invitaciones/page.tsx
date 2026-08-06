'use client'

import { PageHeader } from '@/components/PageHeader'
import { FormEvent, useCallback, useEffect, useState } from 'react'

type Referral = {
  id: string
  referred_name: string | null
  referred_email: string | null
  status: string
  reward_percent: number | null
  reward_note: string | null
  rewarded_at: string | null
  created_at: string
  referrer: { id: string; name: string } | null
  referred: { id: string; name: string } | null
}

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Sin registrarse', className: 'bg-slate-100 text-slate-600' },
  REGISTERED: { label: 'Registrado · falta confirmar', className: 'bg-amber-50 text-amber-800' },
  REWARDED: { label: 'Descuento aplicado', className: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { label: 'Cancelada', className: 'bg-red-50 text-red-700' },
}

export default function PlatformReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [promo, setPromo] = useState({ headline: '', percent: 20, terms: '' })
  const [pendingMigration, setPendingMigration] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/platform/referrals', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { setError(body.error ?? 'No se pudieron cargar las invitaciones'); return }
      setReferrals(body.referrals ?? [])
      setPromo(body.promo ?? promo)
      setPendingMigration(Boolean(body.pendingMigration))
      setError('')
    } catch { setError('No se pudieron cargar las invitaciones') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void load() }, [load])

  async function savePromo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(''); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/platform/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referral_headline: form.get('headline'), referral_percent: String(form.get('percent')), referral_terms: form.get('terms') }),
    })
    if (!response.ok) { setError('No se pudo guardar la promoción'); return }
    setMessage('Promoción guardada. Todos los negocios ven este texto.')
    void load()
  }

  async function setStatus(id: string, status: string) {
    const response = await fetch('/api/platform/referrals', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!response.ok) { setError('No se pudo actualizar la invitación'); return }
    void load()
  }

  return <>
    <PageHeader title="Invitaciones" description="Qué negocio trajo a quién y qué descuentos quedan por aplicar."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {pendingMigration && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Falta aplicar la migración de invitaciones en la base de datos.</p>}

    <form onSubmit={savePromo} className="rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">La promoción que ven los negocios</h2>
      <p className="mt-1 text-sm text-[#736f83]">El descuento lo pagas tú, así que este texto se define una sola vez acá.</p>
      <label className="mt-4 block text-sm font-semibold">Titular<input key={promo.headline} name="headline" defaultValue={promo.headline} className="mt-2 w-full rounded-xl border p-3"/></label>
      <label className="mt-4 block text-sm font-semibold">Descuento (%)<input key={promo.percent} name="percent" type="number" min="0" max="100" step="1" defaultValue={promo.percent} className="mt-2 w-full rounded-xl border p-3"/></label>
      <label className="mt-4 block text-sm font-semibold">Condiciones<textarea key={promo.terms} name="terms" rows={2} defaultValue={promo.terms} className="mt-2 w-full rounded-xl border p-3"/></label>
      {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
      <button className="mt-4 rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white">Guardar promoción</button>
    </form>

    <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">Invitaciones</h2>
      <div className="mt-4 space-y-2">
        {referrals.map((referral) => {
          const status = STATUS[referral.status] ?? { label: referral.status, className: 'bg-slate-100 text-slate-600' }
          return <div key={referral.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/5 p-3">
            <div className="min-w-0">
              <b className="text-sm">{referral.referrer?.name ?? 'Negocio'} → {referral.referred?.name ?? referral.referred_name ?? 'invitado'}</b>
              <p className="text-xs text-[#736f83]">{referral.referred_email ?? 'sin correo'} · {referral.reward_percent ?? 0}% · {new Date(referral.created_at).toLocaleDateString('es-CL')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
              {referral.status !== 'REWARDED' && <button onClick={() => void setStatus(referral.id, 'REWARDED')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">Marcar aplicado</button>}
              {referral.status !== 'CANCELLED' && <button onClick={() => void setStatus(referral.id, 'CANCELLED')} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700">Cancelar</button>}
            </div>
          </div>
        })}
        {referrals.length === 0 && !pendingMigration && <p className="py-6 text-center text-sm text-[#736f83]">Todavía no hay invitaciones registradas.</p>}
      </div>
    </section>
  </>
}
