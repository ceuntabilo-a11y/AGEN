'use client'

import { PageHeader } from '@/components/PageHeader'
import { money } from '@/lib/money'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'
import { Bot, MessageCircle, UserRound } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Conversation = {
  id: string
  channel: string
  status: string
  updated_at: string
  client: { id: string; full_name: string; phone: string | null } | null
  last_message: { content: string; sender: string; created_at: string } | null
}

type Impact = { conversations: number; open: number; human: number; agentBookings: number; totalBookings: number; share: number; agentRevenue: number; currency: string }

const SENDER: Record<string, string> = { CLIENT: 'Cliente', AI: 'Agente', HUMAN: 'Equipo', SYSTEM: 'Sistema' }
const STATUS: Record<string, string> = { OPEN: 'Con el agente', HUMAN: 'Atiende el equipo', CLOSED: 'Cerrada' }

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [impact, setImpact] = useState<Impact | null>(null)
  const [selected, setSelected] = useState<any>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, stats] = await Promise.all([
        fetch('/api/admin/conversations', { cache: 'no-store' }),
        fetch('/api/admin/agent-impact', { cache: 'no-store' }),
      ])
      if (!list.ok) { setError('No se pudieron cargar las conversaciones'); return }
      const data = await list.json()
      setConversations(data.conversations ?? [])
      if (stats.ok) setImpact(await stats.json())
      setError('')
    } catch { setError('No se pudieron cargar las conversaciones') }
  }, [])

  useEffect(() => { void load() }, [load])

  async function open(id: string) {
    const response = await fetch(`/api/admin/conversations/${id}`, { cache: 'no-store' })
    if (!response.ok) { setError('No se pudo abrir la conversación'); return }
    setSelected(await response.json())
  }

  async function setStatus(id: string, status: string) {
    const response = await fetch('/api/admin/conversations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!response.ok) { setError('No se pudo cambiar el estado'); return }
    await load()
    await open(id)
  }

  const timezone = selected?.timezone ?? 'America/Santiago'

  return <>
    <PageHeader title="Conversaciones" description="Lo que el agente conversa con los clientes, y cuánto trabajo te ahorra."/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

    {impact && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border border-black/5 bg-white p-5"><MessageCircle className="text-[#5b3df5]"/><p className="mt-3 text-xs uppercase text-[#736f83]">Conversaciones (30 días)</p><b className="text-2xl">{impact.conversations}</b></article>
      <article className="rounded-2xl border border-black/5 bg-white p-5"><Bot className="text-[#5b3df5]"/><p className="mt-3 text-xs uppercase text-[#736f83]">Reservas hechas por el agente</p><b className="text-2xl">{impact.agentBookings}</b><p className="text-xs text-[#736f83]">{impact.share}% de {impact.totalBookings} reservas</p></article>
      <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Vendido por el agente</p><b className="text-2xl">{money(impact.agentRevenue, impact.currency)}</b><p className="text-xs text-[#736f83]">Últimos 30 días</p></article>
      <article className="rounded-2xl border border-black/5 bg-white p-5"><UserRound className="text-[#5b3df5]"/><p className="mt-3 text-xs uppercase text-[#736f83]">Esperando al equipo</p><b className="text-2xl">{impact.human}</b><p className="text-xs text-[#736f83]">{impact.open} con el agente</p></article>
    </section>}

    <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <div className="rounded-2xl border bg-white p-3">
        {conversations.map((conversation) => <button key={conversation.id} onClick={() => void open(conversation.id)} className={`mb-2 w-full rounded-xl p-3 text-left ${selected?.conversation?.id === conversation.id ? 'bg-violet-50' : 'hover:bg-[#f7f6fa]'}`}>
          <div className="flex items-center justify-between gap-2">
            <b className="truncate text-sm">{conversation.client?.full_name ?? 'Cliente sin registrar'}</b>
            <small className="shrink-0 text-xs text-[#736f83]">{conversation.channel}</small>
          </div>
          <p className="mt-1 truncate text-xs text-[#736f83]">{conversation.last_message ? `${SENDER[conversation.last_message.sender] ?? ''}: ${conversation.last_message.content}` : 'Sin mensajes'}</p>
          <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${conversation.status === 'HUMAN' ? 'bg-amber-50 text-amber-800' : conversation.status === 'CLOSED' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{STATUS[conversation.status] ?? conversation.status}</span>
        </button>)}
        {conversations.length === 0 && !error && <p className="p-6 text-center text-sm text-[#736f83]">Todavía no hay conversaciones. Aparecen solas cuando un cliente le escribe al agente.</p>}
      </div>

      <div className="rounded-2xl border bg-white p-5">
        {!selected && <p className="py-10 text-center text-sm text-[#736f83]">Elige una conversación para leerla.</p>}
        {selected && <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-4">
            <div>
              <b>{selected.conversation.client?.full_name ?? 'Cliente sin registrar'}</b>
              <p className="text-sm text-[#736f83]">{selected.conversation.channel} · {STATUS[selected.conversation.status] ?? selected.conversation.status}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.conversation.client && <Link href={`/admin/clientes/${selected.conversation.client.id}`} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Ver ficha</Link>}
              {selected.conversation.status !== 'HUMAN' && <button onClick={() => void setStatus(selected.conversation.id, 'HUMAN')} className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-bold text-amber-800">Atender yo</button>}
              {selected.conversation.status === 'HUMAN' && <button onClick={() => void setStatus(selected.conversation.id, 'OPEN')} className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700">Devolver al agente</button>}
              {selected.conversation.status !== 'CLOSED' && <button onClick={() => void setStatus(selected.conversation.id, 'CLOSED')} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Cerrar</button>}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {selected.messages.map((message: any) => <div key={message.id} className={`max-w-[80%] rounded-2xl p-3 text-sm ${message.direction === 'INBOUND' ? 'bg-[#f2f0f8]' : 'ml-auto bg-violet-50'}`}>
              <p className="whitespace-pre-line leading-6">{message.content}</p>
              <small className="mt-1 block text-[11px] text-[#736f83]">{SENDER[message.sender] ?? message.sender} · {formatInZone(new Date(message.created_at), timezone, { day: 'numeric', month: 'short' })} {formatTimeInZone(message.created_at, timezone)}</small>
            </div>)}
            {selected.messages.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Esta conversación no tiene mensajes guardados.</p>}
          </div>
          <p className="mt-5 rounded-xl bg-[#f7f6fa] p-3 text-xs text-[#736f83]">Las respuestas se envían por WhatsApp desde el agente. Marcar &quot;Atender yo&quot; le avisa al equipo que esta conversación la sigue una persona.</p>
        </>}
      </div>
    </section>
  </>
}
