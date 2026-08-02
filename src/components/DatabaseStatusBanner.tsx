'use client'

import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

export function DatabaseStatusBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let active = true
    async function check() {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' })
        if (active) setOffline(!response.ok)
      } catch {
        if (active) setOffline(true)
      }
    }
    void check()
    const timer = window.setInterval(check, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  if (!offline) return null
  return <div className="flex items-center gap-2 bg-red-800 px-5 py-2 text-sm font-semibold text-white lg:px-8"><WifiOff size={16}/>Sin conexión con Supabase. No se guardarán cambios hasta recuperar la conexión.</div>
}
