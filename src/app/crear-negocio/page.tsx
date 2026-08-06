'use client'
import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

export default function BusinessRegistration() {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [referral, setReferral] = useState('')

  // El código de quien invitó viaja hasta la creación del negocio, incluso si hay confirmación por correo en el medio.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref')?.trim().toUpperCase() ?? ''
    if (code) { sessionStorage.setItem('agen_referral', code); setReferral(code) }
    else setReferral(sessionStorage.getItem('agen_referral') ?? '')
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    if (password.length < 8) { setError('Usa al menos 8 caracteres'); setLoading(false); return }
    const redirect = `${window.location.origin}/auth/callback?next=/configurar-negocio`
    const { data, error: signError } = await createClient().auth.signUp({ email, password, options: { emailRedirectTo: redirect, data: { account_type: 'BUSINESS' } } })
    if (signError) { setError(signError.message); setLoading(false); return }
    if (data.session) window.location.href = '/configurar-negocio'
    else setMessage('Revisa tu correo y confirma la cuenta para continuar.')
    setLoading(false)
  }
  return <main className="grid min-h-screen place-items-center bg-[#f5f4f9] p-5"><form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl"><Link href="/" className="flex items-center gap-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#5b3df5] font-black text-white">A</span><b className="text-xl">Agen</b></Link><h1 className="mt-6 text-2xl font-black">Crea tu negocio</h1>{referral && <p className="mt-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-800">Vienes con una invitación (código <b>{referral}</b>). Al crear tu negocio, quien te invitó recibe su descuento.</p>}<p className="mt-1 text-sm text-[#736f83]">Primero crea la cuenta del administrador.</p><label className="mt-6 block text-sm font-semibold">Correo<input name="email" required type="email" className="mt-2 w-full rounded-xl border p-3"/></label><label className="mt-4 block text-sm font-semibold">Contraseña<input name="password" required type="password" minLength={8} className="mt-2 w-full rounded-xl border p-3"/></label>{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}{message&&<p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}<button disabled={loading||Boolean(message)} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white">{loading?'Creando…':'Continuar'}</button><p className="mt-4 text-center text-sm"><Link href="/registro" className="text-[#5b3df5]">Soy cliente</Link></p></form></main>
}
