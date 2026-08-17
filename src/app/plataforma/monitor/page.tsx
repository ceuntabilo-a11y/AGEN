'use client'
import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Monitor de servicios.
 *
 * Tres estados, no dos: **operativo**, **con error** y **sin configurar** son cosas distintas y
 * mostrar una por otra manda a buscar el problema donde no está. n8n aparecía «sin configurar»
 * estando vivo porque el servidor solo miraba `process.env.N8N_API_URL`, que existe en el
 * equipo de desarrollo y no en el servicio desplegado; ahora la URL se guarda en las claves de
 * plataforma y esta pantalla dice exactamente qué falta cuando falta.
 */

type Servicio = 'OPERATIVO' | 'CAIDO' | 'SIN_CONFIGURAR'
type Salud = { supabase: Servicio; n8n: Servicio }

const ASPECTO: Record<Servicio, { texto: string; clase: string }> = {
  OPERATIVO: { texto: 'Operativo', clase: 'bg-emerald-50 text-emerald-700' },
  CAIDO: { texto: 'Con error', clase: 'bg-red-50 text-red-700' },
  SIN_CONFIGURAR: { texto: 'Sin configurar', clase: 'bg-amber-50 text-amber-800' },
}

const SERVICIOS = [
  { clave: 'supabase' as const, nombre: 'Supabase', descripcion: 'Base de datos y autenticación.', ayuda: null },
  {
    clave: 'n8n' as const,
    nombre: 'n8n',
    descripcion: 'Agente conversacional, recordatorios y campañas.',
    ayuda: 'Guarda la dirección de n8n en Claves de plataforma (campo «URL de n8n») para que el monitor pueda comprobarlo.',
  },
]

export default function PlatformMonitorPage() {
  const [salud, setSalud] = useState<Salud | null>(null)
  const [fallo, setFallo] = useState('')
  const [comprobando, setComprobando] = useState(false)

  const cargar = useCallback(async () => {
    setComprobando(true)
    try {
      const respuesta = await fetch('/api/platform/overview', { cache: 'no-store' })
      const datos = await respuesta.json().catch(() => ({})) as { salud?: Salud; error?: string }
      if (!respuesta.ok || !datos.salud) {
        setFallo(respuesta.status === 401 || respuesta.status === 403
          ? 'Tu sesión expiró. Vuelve a iniciar sesión para verificar los servicios.'
          : datos.error ?? `No se pudo verificar el estado de los servicios (error ${respuesta.status}).`)
        return
      }
      setSalud(datos.salud)
      setFallo('')
    } catch {
      setFallo('No se pudo contactar al servidor de Agen. Revisa tu conexión.')
    } finally {
      setComprobando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
    const temporizador = window.setInterval(() => void cargar(), 30000)
    return () => window.clearInterval(temporizador)
  }, [cargar])

  return <>
    <PageHeader
      title="Monitor"
      description="Salud de los servicios de los que depende Agen."
      action={<button onClick={() => void cargar()} disabled={comprobando} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50">
        <RefreshCw size={16} className={comprobando ? 'animate-spin' : ''} />Re-verificar
      </button>}
    />
    {fallo && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{fallo}{salud && ' Se muestra la última verificación correcta.'}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {SERVICIOS.map((servicio) => {
        const estado = salud?.[servicio.clave]
        const aspecto = estado ? ASPECTO[estado] : { texto: fallo ? 'Sin datos' : 'Verificando…', clase: 'bg-[#f1eff7] text-[#736f83]' }
        return <article key={servicio.clave} className="rounded-2xl border bg-white p-5">
          <b>{servicio.nombre}</b>
          <p className="mt-2 text-sm text-[#736f83]">{servicio.descripcion}</p>
          <span className={`mt-4 inline-block rounded-full px-3 py-1 text-sm font-bold ${aspecto.clase}`}>{aspecto.texto}</span>
          {estado === 'SIN_CONFIGURAR' && servicio.ayuda && <p className="mt-3 text-sm text-amber-800">{servicio.ayuda}</p>}
        </article>
      })}
    </div>
  </>
}
