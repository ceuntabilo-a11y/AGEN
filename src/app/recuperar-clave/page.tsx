'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { createClient } from '@/lib/supabase'

export default function RecoverPasswordPage() {
  const [email,setEmail] = useState('')
  const [loading,setLoading] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const redirectTo = `${window.location.origin}/auth/confirm?type=recovery&next=/auth/set-password`
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })
    if (resetError) {
      const waitMatch = resetError.message.match(/after (\d+) seconds/)
      if (waitMatch) setError(`Ya pediste un enlace hace muy poco. Por seguridad, esperá ${waitMatch[1]} segundos y probá de nuevo.`)
      else setError(`No se pudo enviar el enlace: ${resetError.message}`)
    } else setMessage('Si la cuenta existe, recibirás un enlace para crear una contraseña nueva.')
    setLoading(false)
  }

  return <main className="grid min-h-screen place-items-center bg-[#f5f4f9] p-5"><form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5b3df5] text-xl font-black text-white">A</span><h1 className="mt-6 text-2xl font-black">Recupera tu acceso</h1><p className="mt-1 text-sm text-[#736f83]">Te enviaremos un enlace seguro para cambiar la contraseña.</p><label className="mt-6 block text-sm font-semibold">Correo<input required type="email" value={email} onChange={(event)=>setEmail(event.target.value)} className="mt-2 w-full rounded-xl border px-4 py-3"/></label>{message&&<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}{error&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading?'Enviando…':'Enviar enlace'}</button><Link href="/login" className="mt-4 block text-center text-sm font-bold text-[#5b3df5]">Volver al inicio de sesión</Link></form></main>
}
