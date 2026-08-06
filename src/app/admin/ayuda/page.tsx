'use client'

import { PageHeader } from '@/components/PageHeader'
import { Check, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Step = { key: string; title: string; detail: string; href: string; done: boolean }

const GUIDES: Array<[string, string]> = [
  ['¿Cómo hago una reserva a mano?', 'Agenda → botón "Nueva reserva". Elige cliente, servicio y fecha, pulsa "Buscar disponibilidad" y selecciona una hora de las que aparecen: son las que de verdad están libres.'],
  ['¿Por qué no aparecen horas disponibles?', 'Casi siempre es el horario: Equipo → "Horario" en la tarjeta del profesional. Si no tiene días cargados, no se generan cupos. Revisa también que el servicio esté activo y asignado a ese profesional.'],
  ['¿Cómo cobro algo?', 'Finanzas → "Registrar cobro". Si todavía no te pagaron, guárdalo como "Por cobrar" y márcalo cobrado cuando llegue la plata.'],
  ['¿Cómo le escribo a mis clientes?', 'Marketing → "Nueva campaña". Solo llega a quienes tienen permiso vigente; el número de personas se muestra antes de enviar.'],
  ['¿Qué pasa si un cliente no llega?', 'En la agenda del profesional, botón "No asistió". Queda registrado en su ficha y el seguimiento te propone contactarlo.'],
]

export default function HelpPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [done, setDone] = useState(0)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/admin/onboarding', { cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() })
      .then((data) => { setSteps(data.steps ?? []); setDone(data.done ?? 0) })
      .catch(() => setError(true))
  }, [])

  const percent = steps.length ? Math.round(done / steps.length * 100) : 0

  return <>
    <PageHeader title="Ayuda" description="Primeros pasos y respuestas a lo que más se pregunta."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">No se pudo calcular tu avance.</p>}

    <section className="rounded-2xl border border-black/5 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-extrabold">Tu avance</h2><p className="text-sm text-[#736f83]">{done} de {steps.length} pasos listos</p></div>
        <b className="text-2xl text-[#5b3df5]">{percent}%</b>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#eceaf4]"><div className="h-full rounded-full bg-[#5b3df5] transition-all" style={{ width: `${percent}%` }}/></div>
      <div className="mt-5 space-y-2">
        {steps.map((step) => <Link key={step.key} href={step.href} className={`flex items-center gap-3 rounded-xl border p-3 transition hover:bg-[#f7f6fa] ${step.done ? 'border-emerald-100 bg-emerald-50/40' : 'border-black/5'}`}>
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${step.done ? 'bg-emerald-600 text-white' : 'bg-[#eceaf4] text-[#736f83]'}`}>{step.done ? <Check size={16}/> : <span className="text-xs font-bold">{steps.indexOf(step) + 1}</span>}</span>
          <span className="min-w-0 flex-1"><b className="block text-sm">{step.title}</b><small className="text-[#736f83]">{step.detail}</small></span>
          <ChevronRight size={18} className="shrink-0 text-[#9a96a5]"/>
        </Link>)}
      </div>
    </section>

    <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">Preguntas frecuentes</h2>
      <div className="mt-4 space-y-2">
        {GUIDES.map(([question, answer]) => <details key={question} className="rounded-xl border border-black/5 p-3">
          <summary className="cursor-pointer text-sm font-bold">{question}</summary>
          <p className="mt-2 text-sm leading-6 text-[#4b4761]">{answer}</p>
        </details>)}
      </div>
    </section>
  </>
}
