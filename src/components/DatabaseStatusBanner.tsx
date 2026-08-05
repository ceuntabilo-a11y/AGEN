'use client'

import { LogIn, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

type Status = 'ok' | 'session' | 'offline'

export function DatabaseStatusBanner() {
  const [status, setStatus] = useState<Status>('ok')

  useEffect(() => {
    let active = true
    async function check() {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' })
        if (!active) return
        setStatus(response.ok ? 'ok' : response.status === 401 || response.status === 403 ? 'session' : 'offline')
      } catch {
        if (active) setStatus('offline')
      }
    }
    void check()
    const timer = window.setInterval(check, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  if (status === 'ok') return null
  if (status === 'session') return <div className="flex flex-wrap items-center gap-2 bg-amber-600 px-5 py-2 text-sm font-semibold text-white lg:px-8"><LogIn size={16}/>Tu sesión expiró. Vuelve a iniciar sesión para seguir guardando cambios.<a href="/login" className="underline underline-offset-2">Iniciar sesión</a></div>
  return <div className="flex items-center gap-2 bg-red-800 px-5 py-2 text-sm font-semibold text-white lg:px-8"><WifiOff size={16}/>Sin conexión con la base de datos. No se guardarán cambios hasta recuperar la conexión.</div>
}
