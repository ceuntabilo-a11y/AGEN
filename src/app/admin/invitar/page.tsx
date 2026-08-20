'use client'

import { PageHeader } from '@/components/PageHeader'
import { Check, Copy, Gift, Send, Trash2, Users } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'

type Referral = { id: string; referred_name: string | null; referred_email: string | null; status: string; reward_percent: number | null; rewarded_at: string | null; created_at: string; referred: { name: string } | null }
type Data = { pendingMigration?: boolean; code: string | null; promo: { enabled: boolean; headline: string; percent: number; terms: string }; businessLink: string | null; clientLink: string | null; referrals: Referral[] }

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Invitado, sin contactar todavía', className: 'bg-slate-100 text-slate-600' },
  REGISTERED: { label: 'Ya se unió a Agen · premio por confirmar', className: 'bg-amber-50 text-amber-800' },
  REWARDED: { label: 'Descuento aplicado', className: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { label: 'Cancelada', className: 'bg-red-50 text-red-700' },
}

function CopyBox({ label, value, message }: { label: string; value: string; message: string }) {
  const [copied, setCopied] = useState(false)
  const share = `https://wa.me/?text=${encodeURIComponent(`${message} ${value}`)}`
  return <div>
    <p className="text-sm font-semibold">{label}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-xl border bg-[#f7f6fa] p-3 text-xs">{value}</code>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold">{copied ? <><Check size={16}/>Copiado</> : <><Copy size={16}/>Copiar</>}</button>
      <a href={share} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-[#25d366] px-4 py-2.5 text-sm font-bold text-white"><Send size={16}/>WhatsApp</a>
    </div>
  </div>
}

export default function InvitePage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [qr, setQr] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/referrals', { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { setError(body.error ?? 'No se pudo cargar tu programa de invitaciones'); return }
      setData(body)
      setError('')
    } catch { setError('No se pudo cargar tu programa de invitaciones') }
  }, [])

  useEffect(() => { void load() }, [load])

  // QR para imprimir y dejar en el mesón: se dibuja en el navegador, no sale a ningún servicio externo.
  useEffect(() => {
    if (!data?.clientLink) return
    QRCode.toDataURL(data.clientLink, { width: 480, margin: 1, color: { dark: '#19162b', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [data?.clientLink])

  async function addReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/referrals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), email: form.get('email') }) })
    const body = await response.json().catch(() => ({}))
    setSaving(false)
    if (!response.ok) { setError(body.error ?? 'No se pudo anotar la invitación'); return }
    ;(event.target as HTMLFormElement).reset()
    void load()
  }

  async function removeReferral(id: string) {
    const response = await fetch(`/api/admin/referrals?id=${id}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setError(body.error ?? 'No se pudo borrar'); return }
    void load()
  }

  if (data?.pendingMigration) return <><PageHeader title="Invitar" description="Trae negocios y clientes nuevos."/><p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Falta aplicar la migración de invitaciones en la base de datos.</p></>

  return <>
    <PageHeader title="Invitar" description="Invita a otro dueño de negocio para que el equipo de Agen lo contacte y le muestre el producto."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {!data && !error && <p className="text-sm text-[#736f83]">Cargando…</p>}

    {data && <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-black/5 bg-white p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-[#5b3df5]"><Gift size={20}/></span>
          <div>
            <h2 className="text-lg font-black leading-tight">{data.promo.enabled ? data.promo.headline : 'Invita a un colega a conocer Agen'}</h2>
            <p className="mt-1 text-sm text-[#736f83]">{data.promo.enabled ? data.promo.terms : 'No crea ninguna cuenta: solo pide que lo contactemos para mostrarle el producto.'}</p>
          </div>
        </div>

        {data.businessLink && <div className="mt-5"><CopyBox label="Tu enlace para invitar negocios" value={data.businessLink} message={data.promo.enabled ? data.promo.headline + '.' : 'Te invito a conocer Agen:'}/></div>}
        {data.code && <p className="mt-2 text-xs text-[#736f83]">Tu código: <b>{data.code}</b></p>}

        <form onSubmit={addReferral} className="mt-6 rounded-xl border border-dashed p-3">
          <p className="text-sm font-semibold">Anotar a quién invitaste</p>
          <p className="mt-1 text-xs text-[#736f83]">Opcional, para no perderle el rastro antes de que pida que lo contacten.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="name" required placeholder="Nombre del negocio" className="w-full rounded-xl border p-3 text-sm"/>
            <input name="email" type="email" placeholder="Su correo (opcional)" className="w-full rounded-xl border p-3 text-sm"/>
          </div>
          <button disabled={saving} className="mt-3 rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50">{saving ? 'Guardando…' : 'Anotar'}</button>
        </form>

        <div className="mt-5 space-y-2">
          {data.referrals.map((referral) => {
            const status = STATUS[referral.status] ?? { label: referral.status, className: 'bg-slate-100 text-slate-600' }
            return <div key={referral.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/5 p-3">
              <div className="min-w-0">
                <b className="text-sm">{referral.referred?.name ?? referral.referred_name ?? 'Negocio invitado'}</b>
                {referral.referred_email && <p className="text-xs text-[#736f83]">{referral.referred_email}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>{status.label}</span>
                {referral.status === 'PENDING' && <button aria-label="Borrar invitación" onClick={() => void removeReferral(referral.id)} className="rounded-lg border border-red-200 p-1.5 text-red-700"><Trash2 size={14}/></button>}
              </div>
            </div>
          })}
          {data.referrals.length === 0 && <p className="py-4 text-center text-sm text-[#736f83]">Todavía no invitaste a ningún negocio.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-[#5b3df5]"><Users size={20}/></span>
          <div>
            <h2 className="text-lg font-black leading-tight">Invita a tus clientes</h2>
            <p className="mt-1 text-sm text-[#736f83]">Con este enlace entran directo a crear su cuenta en tu negocio: no tienen que escribir ningún código.</p>
          </div>
        </div>
        {data.clientLink && <div className="mt-5"><CopyBox label="Tu enlace para clientes" value={data.clientLink} message="Reserva tu hora en línea con nosotros:"/></div>}
        {qr && <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-black/5 bg-[#f7f6fa] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código QR del enlace para clientes" className="h-32 w-32 rounded-xl bg-white p-2"/>
          <div className="min-w-0">
            <b className="text-sm">Código QR</b>
            <p className="mt-1 text-sm text-[#736f83]">Imprímelo y déjalo en el mesón: quien lo escanea llega directo a crear su cuenta.</p>
            <a href={qr} download="agen-invitacion-clientes.png" className="mt-3 inline-block rounded-xl border bg-white px-4 py-2 text-sm font-bold">Descargar QR</a>
          </div>
        </div>}
        <ul className="mt-5 space-y-2 text-sm text-[#4b4761]">
          <li>· Pégalo en tu estado de WhatsApp, en Instagram o en tu ficha de Google.</li>
          <li>· Para invitar a un cliente que ya tienes en la agenda, abre su ficha y usa el botón <b>Invitar</b>: el mensaje sale con su nombre y su teléfono ya cargados.</li>
          <li>· Al entrar, el cliente ve el nombre de tu negocio y solo elige su contraseña.</li>
        </ul>
      </section>
    </div>}
  </>
}
