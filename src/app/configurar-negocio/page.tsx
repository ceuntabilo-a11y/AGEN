'use client'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function BusinessSetup() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [editedSlug, setEditedSlug] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [referral, setReferral] = useState('')

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase()
    setReferral(fromUrl || sessionStorage.getItem('agen_referral') || '')
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, slug, phone: form.get('phone'), address: form.get('address'), timezone: form.get('timezone'), currency: form.get('currency'), referralCode: referral || undefined }) })
    const data = await response.json()
    if (!response.ok) { setError(data.error ?? 'No se pudo crear'); setLoading(false); return }
    sessionStorage.removeItem('agen_referral')
    router.replace('/admin')
    router.refresh()
  }
  return <main className="grid min-h-screen place-items-center bg-[#f5f4f9] p-5"><form onSubmit={submit} className="w-full max-w-xl rounded-3xl bg-white p-7 shadow-xl"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5b3df5] text-xl font-black text-white">A</span><h1 className="mt-6 text-2xl font-black">Configura tu negocio</h1><p className="mt-1 text-sm text-[#736f83]">Crearemos la sucursal principal y las especialidades iniciales.</p><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Nombre<input required value={name} onChange={(event)=>{setName(event.target.value);if(!editedSlug)setSlug(slugify(event.target.value))}} className="mt-2 w-full rounded-xl border p-3"/></label><label className="text-sm font-semibold">Código<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(event)=>{setEditedSlug(true);setSlug(slugify(event.target.value))}} className="mt-2 w-full rounded-xl border p-3"/><small className="font-normal text-[#736f83]">Los clientes usarán este código.</small></label><label className="text-sm font-semibold">Teléfono<input name="phone" className="mt-2 w-full rounded-xl border p-3"/></label><label className="text-sm font-semibold">Dirección<input name="address" className="mt-2 w-full rounded-xl border p-3"/></label><label className="text-sm font-semibold">Zona horaria<select name="timezone" defaultValue="America/Santiago" className="mt-2 w-full rounded-xl border p-3"><option value="America/Santiago">Chile</option><option value="America/Bogota">Colombia</option><option value="America/Lima">Perú</option><option value="America/Mexico_City">México</option><option value="America/Argentina/Buenos_Aires">Argentina</option><option value="Europe/Madrid">España</option></select></label><label className="text-sm font-semibold">Moneda<select name="currency" defaultValue="CLP" className="mt-2 w-full rounded-xl border p-3"><option value="CLP">CLP</option><option value="USD">USD</option><option value="COP">COP</option><option value="PEN">PEN</option><option value="MXN">MXN</option><option value="EUR">EUR</option><option value="ARS">ARS</option></select></label></div>{error&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white">{loading?'Creando negocio…':'Entrar al panel'}</button></form></main>
}
