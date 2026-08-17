'use client'
import { FormEvent, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'

/**
 * Donde el dueño invitado define su contraseña y entra por primera vez.
 *
 * Aquí se aterriza desde el botón del correo, ya con la sesión abierta por `/auth/confirm`. Lo
 * que faltaba era decir A QUÉ se está entrando: la pantalla decía «Crea tu contraseña» a secas,
 * y quien llega desde un correo que abrió días después no tiene forma de saber si está en el
 * sitio correcto. El nombre del negocio viaja en `?negocio=` desde el enlace de la invitación.
 */

const LARGO_MINIMO = 8

function Formulario() {
  const parametros = useSearchParams()
  const negocio = parametros.get('negocio')?.slice(0, 80) ?? ''

  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const router = useRouter()

  async function enviar(evento: FormEvent) {
    evento.preventDefault()
    if (guardando) return
    if (password.length < LARGO_MINIMO) { setError(`Usa al menos ${LARGO_MINIMO} caracteres`); return }
    if (password !== confirmacion) { setError('Las contraseñas no coinciden'); return }

    setGuardando(true); setError('')
    const db = createClient()
    const { error: fallo } = await db.auth.updateUser({ password })
    if (fallo) {
      // El caso que más se ve: el enlace caducó o ya se usó, así que no hay sesión que actualizar.
      setError(/session|jwt|token/i.test(fallo.message)
        ? 'Tu enlace de activación ya no es válido. Pide que te lo reenvíen desde Agen.'
        : fallo.message)
      setGuardando(false)
      return
    }

    // El destino sale del rol real, no de lo que diga la URL: el mismo formulario sirve para
    // activar una invitación y para recuperar una contraseña.
    const respuesta = await fetch('/api/session', { cache: 'no-store' })
    const sesion = respuesta.ok ? await respuesta.json() as { role?: string } : null
    router.replace(sesion?.role === 'PROFESSIONAL' ? '/profesional' : sesion?.role === 'CLIENT' ? '/cliente' : '/admin')
  }

  return <form onSubmit={enviar} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-xl">
    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5b3df5] text-xl font-black text-white">A</span>

    {negocio
      ? <>
        <h1 className="mt-6 text-2xl font-black">Activa tu cuenta para {negocio}</h1>
        <p className="mt-1 text-sm text-[#736f83]">Elige una contraseña y entras directo a tu panel.</p>
      </>
      : <>
        <h1 className="mt-6 text-2xl font-black">Crea tu contraseña</h1>
        <p className="mt-1 text-sm text-[#736f83]">Activa o recupera tu acceso seguro a Agen.</p>
      </>}

    <label className="mt-6 block text-sm font-semibold">
      Contraseña
      <input
        required type="password" autoComplete="new-password" minLength={LARGO_MINIMO}
        value={password} onChange={(e) => setPassword(e.target.value)}
        className="mt-2 w-full rounded-xl border px-4 py-3"
      />
      <span className="mt-1 block text-xs font-normal text-[#736f83]">Mínimo {LARGO_MINIMO} caracteres.</span>
    </label>

    <label className="mt-4 block text-sm font-semibold">
      Confirmar
      <input
        required type="password" autoComplete="new-password"
        value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)}
        className="mt-2 w-full rounded-xl border px-4 py-3"
      />
    </label>

    {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

    <button disabled={guardando} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">
      {guardando ? 'Guardando…' : negocio ? 'Activar mi cuenta' : 'Guardar contraseña'}
    </button>
  </form>
}

export default function SetPasswordPage() {
  return <main className="grid min-h-screen place-items-center bg-[#f5f4f9] p-5">
    {/* `useSearchParams` obliga a un límite de Suspense en el App Router. */}
    <Suspense fallback={<p className="text-sm text-[#736f83]">Cargando…</p>}>
      <Formulario />
    </Suspense>
  </main>
}
