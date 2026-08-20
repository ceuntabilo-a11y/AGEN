'use client'

import { PageHeader } from '@/components/PageHeader'
import { ARTICULOS_AYUDA } from '@/lib/help-content'
import { buscarAyuda } from '@/lib/help-search'
import { Check, ChevronRight, Search } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Step = { key: string; title: string; detail: string; href: string; done: boolean }

const CATEGORIAS = Array.from(new Set(ARTICULOS_AYUDA.map((articulo) => articulo.categoria)))

export default function HelpPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [done, setDone] = useState(0)
  const [error, setError] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/onboarding', { cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() })
      .then((data) => { setSteps(data.steps ?? []); setDone(data.done ?? 0) })
      .catch(() => setError(true))
  }, [])

  const percent = steps.length ? Math.round(done / steps.length * 100) : 0

  const resultados = useMemo(() => {
    if (consulta.trim()) return buscarAyuda(consulta, ARTICULOS_AYUDA, 8)
    return ARTICULOS_AYUDA.filter((articulo) => !categoria || articulo.categoria === categoria)
  }, [consulta, categoria])

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
      <div className="relative mt-3">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9a96a5]"/>
        <input
          type="search"
          value={consulta}
          onChange={(event) => setConsulta(event.target.value)}
          placeholder="Escribe tu pregunta, por ejemplo: cómo cambio la hora de una cita"
          className="w-full rounded-xl border border-black/10 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#5b3df5]"
        />
      </div>

      {!consulta.trim() && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setCategoria(null)} className={`rounded-full px-3 py-1 text-xs font-bold ${!categoria ? 'bg-[#5b3df5] text-white' : 'bg-[#eceaf4] text-[#4b4761]'}`}>Todas</button>
        {CATEGORIAS.map((cat) => <button key={cat} type="button" onClick={() => setCategoria(cat)} className={`rounded-full px-3 py-1 text-xs font-bold ${categoria === cat ? 'bg-[#5b3df5] text-white' : 'bg-[#eceaf4] text-[#4b4761]'}`}>{cat}</button>)}
      </div>}

      <div className="mt-4 space-y-2">
        {resultados.map((articulo) => <details key={articulo.id} className="rounded-xl border border-black/5 p-3">
          <summary className="cursor-pointer text-sm font-bold">{articulo.pregunta}</summary>
          <p className="mt-2 text-sm leading-6 text-[#4b4761]">{articulo.respuesta}</p>
        </details>)}
        {consulta.trim() && !resultados.length && <p className="rounded-xl bg-[#f7f6fa] p-3 text-sm text-[#736f83]">
          No encontramos nada para &quot;{consulta.trim()}&quot;. Prueba con otras palabras, o escríbenos desde Conversaciones si no lo encuentras.
        </p>}
      </div>
    </section>
  </>
}
