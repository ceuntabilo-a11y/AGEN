'use client'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const db = createClient()
      const { data, error: authError } = await db.auth.signInWithPassword({ email, password })
      if (authError) throw authError
      const { data: member, error: memberError } = await db.from('business_members').select('role').eq('user_id', data.user.id).eq('active', true).limit(1).maybeSingle()
      if (memberError) throw memberError
      if (member) router.replace(member.role === 'PROFESSIONAL' ? '/profesional' : '/admin')
      else {
        const { data: client } = await db.from('clients').select('id').eq('user_id', data.user.id).limit(1).maybeSingle()
        if (client) router.replace('/cliente')
        else router.replace(data.user.user_metadata?.account_type === 'BUSINESS' ? '/configurar-negocio' : '/cliente/onboarding')
      }
      router.refresh()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo iniciar sesión') }
    finally { setLoading(false) }
  }
  return <><form onSubmit={submit} className="mt-8 space-y-4"><label className="block text-sm font-semibold">Correo<input value={email} onChange={(event)=>setEmail(event.target.value)} required type="email" placeholder="tu@negocio.com" className="mt-2 w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-[#5b3df5]"/></label><label className="block text-sm font-semibold">Contraseña<input value={password} onChange={(event)=>setPassword(event.target.value)} required type="password" placeholder="••••••••" className="mt-2 w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-[#5b3df5]"/></label>{error&&<p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}<button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5b3df5] px-5 py-3.5 font-bold text-white disabled:opacity-50">{loading?'Ingresando…':'Entrar'} <ArrowRight size={18}/></button></form><p className="mt-5 text-center text-xs text-[#736f83]"><Link className="font-bold text-[#5b3df5]" href="/crear-negocio">Crear negocio</Link> · <Link className="font-bold text-[#5b3df5]" href="/registro">Crear cuenta de cliente</Link></p></>
}
