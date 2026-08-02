'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function UnsubscribeContent() {
  const token = useSearchParams().get('token')
  const [state,setState] = useState<'idle'|'loading'|'done'|'error'>('idle')
  async function unsubscribe() {
    setState('loading')
    const response = await fetch('/api/unsubscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})})
    setState(response.ok?'done':'error')
  }
  return <main className="grid min-h-screen place-items-center bg-[#f5f4f9] p-5"><section className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-xl"><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-[#5b3df5] text-xl font-black text-white">A</span><h1 className="mt-6 text-2xl font-black">Preferencias de correo</h1>{state==='done'?<p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">Dejaste de recibir promociones por email. Seguirás recibiendo información necesaria sobre tus propias reservas.</p>:<><p className="mt-3 text-sm text-[#736f83]">Puedes cancelar únicamente los correos promocionales. Las confirmaciones y recordatorios de tus reservas no se desactivan.</p><button disabled={!token||state==='loading'} onClick={unsubscribe} className="mt-6 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{state==='loading'?'Procesando…':'Dejar de recibir promociones'}</button>{state==='error'&&<p className="mt-4 text-sm text-red-700">El enlace no es válido o ya no está disponible.</p>}</>}</section></main>
}

export default function UnsubscribePage() {
  return <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#f5f4f9] text-sm text-[#736f83]">Cargando…</main>}><UnsubscribeContent/></Suspense>
}
