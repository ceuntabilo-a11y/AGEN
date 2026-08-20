'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, Send, X } from 'lucide-react'
import { FormEvent, PointerEvent, useEffect, useRef, useState } from 'react'

/**
 * El asistente flotante de Agen: copiloto de datos reales del negocio + ayuda de cómo funciona
 * cualquier pantalla, en un solo botón que sigue al dueño a donde vaya dentro del panel.
 *
 * Es de solo lectura por diseño, igual que el resto de la capa de IA de Agen: explica y sugiere,
 * nunca ejecuta nada él mismo (ver el system prompt en `/api/admin/copilot`). Y es arrastrable
 * — antes quedaba fijo abajo a la izquierda tapando lo que hubiera ahí; ahora el dueño lo mueve
 * una vez y se queda ahí, en cualquier pantalla, guardado en su navegador.
 */

type Reply = { reply: string; href?: string; label?: string }
type Posicion = { x: number; y: number }

const suggestions = ['¿Qué hay hoy?', '¿Qué seguimientos tengo?', '¿Cómo agrego un cliente?', '¿Cómo cambio el horario de un profesional?']
const POSICION_GUARDADA = 'agen_asistente_pos'

function leerPosicionGuardada(): Posicion | null {
  if (typeof window === 'undefined') return null
  try {
    const guardada = window.localStorage.getItem(POSICION_GUARDADA)
    if (!guardada) return null
    const { x, y } = JSON.parse(guardada) as Posicion
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  } catch { return null }
}

function acotar(pos: Posicion): Posicion {
  const ancho = window.innerWidth
  const alto = window.innerHeight
  return { x: Math.min(Math.max(pos.x, 8), ancho - 56), y: Math.min(Math.max(pos.y, 8), alto - 56) }
}

export function Copilot() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState<Reply | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pos, setPos] = useState<Posicion | null>(null)
  const arrastrando = useRef(false)
  const movido = useRef(false)
  const desfase = useRef({ x: 0, y: 0 })

  useEffect(() => { setPos(leerPosicionGuardada()) }, [])

  async function ask(value: string) {
    setLoading(true); setError('')
    const response = await fetch('/api/admin/copilot', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: value, page: pathname }),
    })
    const data = await response.json()
    if (response.ok) setReply(data); else setError(data.error ?? 'No se pudo consultar')
    setLoading(false)
  }
  function submit(event: FormEvent) { event.preventDefault(); if (question.trim()) void ask(question.trim()) }

  function alPresionar(event: PointerEvent<HTMLButtonElement>) {
    arrastrando.current = true; movido.current = false
    const rect = event.currentTarget.getBoundingClientRect()
    desfase.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function alMover(event: PointerEvent<HTMLButtonElement>) {
    if (!arrastrando.current) return
    movido.current = true
    setPos(acotar({ x: event.clientX - desfase.current.x, y: event.clientY - desfase.current.y }))
  }
  function alSoltar(event: PointerEvent<HTMLButtonElement>) {
    arrastrando.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    setPos((actual) => {
      if (actual) { try { window.localStorage.setItem(POSICION_GUARDADA, JSON.stringify(actual)) } catch { /* localStorage puede estar bloqueado */ } }
      return actual
    })
    if (!movido.current) setOpen((valor) => !valor)
  }

  const estiloBoton = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } as const : undefined
  const estiloPanel = pos ? { left: Math.min(pos.x, window.innerWidth - 406), top: Math.max(8, pos.y - 440) } as const : undefined

  return <>
    <button
      aria-label="Abrir el asistente de Agen"
      title="Arrástrame para moverme"
      onPointerDown={alPresionar}
      onPointerMove={alMover}
      onPointerUp={alSoltar}
      style={estiloBoton}
      className={`fixed z-[70] grid h-12 w-12 touch-none place-items-center rounded-2xl bg-[#5b3df5] text-white shadow-xl ${pos ? 'cursor-grab active:cursor-grabbing' : 'bottom-5 left-5 lg:left-[276px]'}`}
    ><Bot/></button>

    {open && <section
      style={estiloPanel}
      className={`fixed z-[90] w-[min(390px,calc(100vw-40px))] overflow-hidden rounded-3xl border bg-white shadow-2xl ${pos ? '' : 'bottom-20 left-5 lg:left-[276px]'}`}
    >
      <header className="flex items-center justify-between bg-[#19162b] p-4 text-white">
        <div className="flex items-center gap-2"><Bot size={19}/><div><b className="text-sm">Agen</b><p className="text-[11px] text-white/55">Pregúntame lo que sea sobre tu negocio o cómo funciona esto</p></div></div>
        <button aria-label="Cerrar" onClick={() => setOpen(false)}><X size={18}/></button>
      </header>
      <div className="min-h-48 p-4">
        {reply
          ? <>
            <p className="text-sm leading-6">{reply.reply}</p>
            {reply.href && <Link href={reply.href} onClick={() => setOpen(false)} className="mt-4 inline-block rounded-xl bg-violet-50 px-4 py-2 text-sm font-bold text-[#5b3df5]">{reply.label}</Link>}
          </>
          : <>
            <p className="text-sm text-[#736f83]">Pregunta sobre tu negocio, o cómo funciona cualquier pantalla de Agen.</p>
            <div className="mt-3 flex flex-wrap gap-2">{suggestions.map((item) => <button key={item} onClick={() => void ask(item)} className="rounded-full border px-3 py-2 text-xs font-semibold">{item}</button>)}</div>
          </>}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t p-3">
        <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={300} placeholder="Pregunta lo que sea" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"/>
        <button disabled={loading || !question.trim()} className="grid h-10 w-10 place-items-center rounded-xl bg-[#5b3df5] text-white disabled:opacity-40"><Send size={16}/></button>
      </form>
    </section>}
  </>
}
