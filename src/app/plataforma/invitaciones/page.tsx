'use client'

import { ModalShell } from '@/components/ModalShell'
import { PageHeader } from '@/components/PageHeader'
import { FormEvent, useCallback, useEffect, useState } from 'react'

type Referral = {
  id: string
  referred_name: string | null
  referred_email: string | null
  referred_phone: string | null
  referred_business_type: string | null
  status: string
  reward_percent: number | null
  reward_note: string | null
  rewarded_at: string | null
  created_at: string
  referrer: { id: string; name: string } | null
  referred: { id: string; name: string } | null
}

type PromoDraft = { enabled: boolean; headline: string; percent: number; terms: string }
type Accion = { referral: Referral; status: 'REWARDED' | 'CANCELLED' }

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Sin registrarse', className: 'bg-slate-100 text-slate-600' },
  REGISTERED: { label: 'Registrado · falta confirmar', className: 'bg-amber-50 text-amber-800' },
  REWARDED: { label: 'Descuento aplicado', className: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { label: 'Cancelada', className: 'bg-red-50 text-red-700' },
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 p-3 text-sm">
    <dt className="text-[#736f83]">{etiqueta}</dt>
    <dd className="text-right font-semibold">{children}</dd>
  </div>
}

export default function PlatformReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [promo, setPromo] = useState({ enabled: true, headline: '', percent: 20, terms: '' })
  const [pendingMigration, setPendingMigration] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmandoPromo, setConfirmandoPromo] = useState<PromoDraft | null>(null)
  const [guardandoPromo, setGuardandoPromo] = useState(false)
  const [accion, setAccion] = useState<Accion | null>(null)
  const [aplicando, setAplicando] = useState(false)

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

  function prepararGuardado(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(''); setError('')
    const form = new FormData(event.currentTarget)
    setConfirmandoPromo({
      enabled: form.get('enabled') === 'on',
      headline: String(form.get('headline') ?? '').trim(),
      percent: Number(form.get('percent') ?? 0),
      terms: String(form.get('terms') ?? '').trim(),
    })
  }

  async function confirmarGuardado() {
    if (!confirmandoPromo) return
    setGuardandoPromo(true); setError('')
    try {
      const response = await fetch('/api/platform/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          referral_enabled: confirmandoPromo.enabled ? 'true' : 'false',
          referral_headline: confirmandoPromo.headline,
          referral_percent: String(confirmandoPromo.percent),
          referral_terms: confirmandoPromo.terms,
        }),
      })
      if (!response.ok) { setError('No se pudo guardar la promoción'); return }
      setConfirmandoPromo(null)
      setMessage('Guardado con éxito. Todos los negocios ven este texto.')
      void load()
    } finally {
      setGuardandoPromo(false)
    }
  }

  async function confirmarAccion() {
    if (!accion) return
    setAplicando(true)
    try {
      const response = await fetch('/api/platform/referrals', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: accion.referral.id, status: accion.status }),
      })
      if (!response.ok) { setError('No se pudo actualizar la invitación'); return }
      setAccion(null)
      void load()
    } finally {
      setAplicando(false)
    }
  }

  return <>
    <PageHeader title="Invitaciones" description="Quién pidió que lo contactaran, qué negocio lo invitó y qué descuentos quedan por aplicar."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {pendingMigration && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Falta aplicar la migración de invitaciones en la base de datos.</p>}

    <form onSubmit={prepararGuardado} className="rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">La promoción que ven los negocios</h2>
      <p className="mt-1 text-sm text-[#736f83]">El descuento lo pagas tú. Apágala cuando quieras — la pantalla de Invitar de cada negocio deja de mencionar ningún premio.</p>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold"><input key={String(promo.enabled)} name="enabled" type="checkbox" defaultChecked={promo.enabled}/>Promoción activa</label>
      <label className="mt-4 block text-sm font-semibold">Titular<input key={promo.headline} name="headline" defaultValue={promo.headline} className="mt-2 w-full rounded-xl border p-3"/></label>
      <label className="mt-4 block text-sm font-semibold">Descuento (%)<input key={promo.percent} name="percent" type="number" min="0" max="100" step="1" defaultValue={promo.percent} className="mt-2 w-full rounded-xl border p-3"/></label>
      <label className="mt-4 block text-sm font-semibold">Condiciones<textarea key={promo.terms} name="terms" rows={2} defaultValue={promo.terms} className="mt-2 w-full rounded-xl border p-3"/></label>
      {message && <p className="mt-3 text-sm font-bold text-emerald-700" role="status">✓ {message}</p>}
      <button className="mt-4 rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white">Revisar y guardar</button>
    </form>

    <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">Pedidos de contacto</h2>
      <p className="mt-1 text-sm text-[#736f83]">Cada fila es una persona que pidió que la contactaran desde el enlace de invitar de algún negocio (o llegó sola, sin código). &quot;Marcar aplicado&quot; y &quot;Cancelar&quot; son solo un registro tuyo — no descuentan ni cobran nada por sí solos.</p>
      <div className="mt-4 space-y-2">
        {referrals.map((referral) => {
          const status = STATUS[referral.status] ?? { label: referral.status, className: 'bg-slate-100 text-slate-600' }
          return <div key={referral.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/5 p-3">
            <div className="min-w-0">
              <b className="text-sm">{referral.referred?.name ?? referral.referred_name ?? 'Interesado'}</b>
              <p className="text-xs text-[#736f83]">
                {referral.referred_phone ?? 'sin teléfono'} · {referral.referred_email ?? 'sin correo'}
                {referral.referred_business_type && <> · {referral.referred_business_type}</>}
                {' · '}invitado por {referral.referrer?.name ?? 'nadie (llegó solo)'} · {referral.reward_percent ?? 0}% · {new Date(referral.created_at).toLocaleDateString('es-CL')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
              {referral.status !== 'REWARDED' && <button onClick={() => setAccion({ referral, status: 'REWARDED' })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">Marcar aplicado</button>}
              {referral.status !== 'CANCELLED' && <button onClick={() => setAccion({ referral, status: 'CANCELLED' })} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700">Cancelar</button>}
            </div>
          </div>
        })}
        {referrals.length === 0 && !pendingMigration && <p className="py-6 text-center text-sm text-[#736f83]">Todavía no hay invitaciones registradas.</p>}
      </div>
    </section>

    {confirmandoPromo && <ModalShell titulo="Confirmar promoción" onClose={() => !guardandoPromo && setConfirmandoPromo(null)}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6">
        <h2 className="text-xl font-black">¿Guardamos esta promoción?</h2>
        <p className="mt-1 text-sm text-[#736f83]">Así la va a ver cada negocio en su pantalla de Invitar. Puedes volver a editar antes de guardar.</p>
        <dl className="mt-4 divide-y rounded-2xl border">
          <Fila etiqueta="Estado">{confirmandoPromo.enabled ? 'Activa' : 'Apagada (no se muestra a nadie)'}</Fila>
          <Fila etiqueta="Titular">{confirmandoPromo.headline || '—'}</Fila>
          <Fila etiqueta="Descuento">{confirmandoPromo.percent}%</Fila>
          <Fila etiqueta="Condiciones">{confirmandoPromo.terms || '—'}</Fila>
        </dl>
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        <div className="mt-6 flex gap-2">
          <button onClick={() => setConfirmandoPromo(null)} disabled={guardandoPromo} className="flex-1 rounded-xl border py-3 font-bold disabled:opacity-50">Volver a editar</button>
          <button onClick={() => void confirmarGuardado()} disabled={guardandoPromo} className="flex-1 rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{guardandoPromo ? 'Guardando…' : 'Confirmar y guardar'}</button>
        </div>
      </div>
    </ModalShell>}

    {accion && <ModalShell titulo={accion.status === 'REWARDED' ? 'Marcar descuento aplicado' : 'Cancelar invitación'} onClose={() => !aplicando && setAccion(null)}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6">
        <h2 className="text-xl font-black">{accion.status === 'REWARDED' ? '¿Marcar el descuento como aplicado?' : '¿Cancelar este pedido de contacto?'}</h2>
        <p className="mt-2 text-sm text-[#736f83]">
          {accion.status === 'REWARDED'
            ? <>Esto queda solo como un registro de que TÚ ya le aplicaste a mano el {accion.referral.reward_percent ?? 0}% de descuento a <b>{accion.referral.referrer?.name ?? 'quien invitó'}</b> en su facturación. El sistema no descuenta nada solo — es para que no se te olvide ni se lo apliques dos veces.</>
            : <>Se marca que el pedido de contacto de <b>{accion.referral.referred?.name ?? accion.referral.referred_name ?? 'el interesado'}</b> no siguió adelante. No borra sus datos, solo lo saca de los pendientes por resolver.</>}
        </p>
        {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={() => setAccion(null)} disabled={aplicando} className="flex-1 rounded-xl border py-2.5 font-bold disabled:opacity-50">Volver</button>
          <button onClick={() => void confirmarAccion()} disabled={aplicando} className={`flex-1 rounded-xl py-2.5 font-bold text-white disabled:opacity-50 ${accion.status === 'REWARDED' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {aplicando ? 'Guardando…' : accion.status === 'REWARDED' ? 'Sí, marcar aplicado' : 'Sí, cancelar'}
          </button>
        </div>
      </div>
    </ModalShell>}
  </>
}
