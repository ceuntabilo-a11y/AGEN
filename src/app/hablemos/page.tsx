'use client'
import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'

export default function HablemosPage() {
  const [referral, setReferral] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [enviado, setEnviado] = useState(false)

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() ?? ''
    if (code) setReferral(code)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        businessName: form.get('businessName'),
        businessType: form.get('businessType'),
        phone: form.get('phone'),
        email: form.get('email'),
        referralCode: referral || undefined,
      }),
    })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo enviar tu pedido'); return }
    setEnviado(true)
  }

  return <main className="grid min-h-screen place-items-center bg-[#f5f4f9] p-5">
    <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl">
      <Link href="/" className="flex items-center gap-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#5b3df5] font-black text-white">A</span><b className="text-xl">Agen</b></Link>

      {enviado
        ? <><h1 className="mt-6 text-2xl font-black">¡Listo!</h1><p className="mt-3 text-sm text-[#4b4761]">Ya quedó tu pedido. El equipo de Agen te va a escribir para mostrarte cómo funciona, sin compromiso.</p></>
        : <>
          <h1 className="mt-6 text-2xl font-black">Conoce Agen</h1>
          <p className="mt-1 text-sm text-[#736f83]">Cuéntanos de tu negocio y te contactamos para mostrarte cómo funciona — sin crear ninguna cuenta todavía.</p>
          {referral && <p className="mt-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-800">Vienes invitado por otro negocio (código <b>{referral}</b>).</p>}

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">Tu nombre<input name="name" required className="mt-2 w-full rounded-xl border p-3"/></label>
            <label className="block text-sm font-semibold">Nombre de tu negocio<input name="businessName" required className="mt-2 w-full rounded-xl border p-3"/></label>
            <label className="block text-sm font-semibold">¿A qué se dedica? (opcional)<input name="businessType" placeholder="Ej: peluquería, spa, barbería…" className="mt-2 w-full rounded-xl border p-3"/></label>
            <label className="block text-sm font-semibold">WhatsApp<input name="phone" type="tel" required placeholder="+56 9 1234 5678" className="mt-2 w-full rounded-xl border p-3"/></label>
            <label className="block text-sm font-semibold">Correo (opcional)<input name="email" type="email" className="mt-2 w-full rounded-xl border p-3"/></label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={loading} className="w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Enviando…' : 'Quiero que me contacten'}</button>
          </form>
        </>}

      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-[#5b3df5]">Ya tengo cuenta</Link></p>
    </div>
  </main>
}
