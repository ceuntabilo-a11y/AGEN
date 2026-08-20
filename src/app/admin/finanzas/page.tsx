'use client'

import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { NewQuoteModal } from '@/components/NewQuoteModal'
import { NewPaymentModal } from '@/components/NewPaymentModal'
import { NewExpenseModal } from '@/components/NewExpenseModal'
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal'
import { FinanceDetailModal, type FichaFinanciera } from '@/components/FinanceDetailModal'
import { money } from '@/lib/money'
import { mensajeDeFallo } from '@/lib/api-fetch-error'
import { formatInZone } from '@/lib/timezone'
import { CircleDollarSign, HandCoins, PackageOpen, Plus, Search, Trash2, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type Data = {
  sales: number; directCosts: number; commissions: number; operatingExpenses: number; net: number; receivable: number
  quotes: any[]; recentPayments: any[]; recentExpenses: any[]; pendingPayments: any[]
  currency: string; timezone: string; business?: Record<string, any>
}

const EMPTY: Data = { sales: 0, directCosts: 0, commissions: 0, operatingExpenses: 0, net: 0, receivable: 0, quotes: [], recentPayments: [], recentExpenses: [], pendingPayments: [], currency: 'CLP', timezone: 'America/Santiago' }
const QUOTE_STATUS: Record<string, string> = { DRAFT: 'Borrador', SENT: 'Enviado', ACCEPTED: 'Aceptado', REJECTED: 'Rechazado', EXPIRED: 'Vencido', CONVERTED: 'Convertido' }
const TABS: Array<[string, string]> = [['cobros', 'Cobros'], ['gastos', 'Gastos'], ['presupuestos', 'Presupuestos']]

export default function FinancePage() {
  const [data, setData] = useState<Data>(EMPTY)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('cobros')
  const [modal, setModal] = useState<'quote' | 'payment' | 'expense' | null>(null)
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'payment' | 'expense' | 'quote'; id: string; detail: string } | null>(null)
  const [ficha, setFicha] = useState<FichaFinanciera | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [buscado, setBuscado] = useState('')

  const load = useCallback((q = buscado) => fetch(`/api/admin/finance${q ? `?q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) { setError(mensajeDeFallo(response.status, 'ver las cifras de Finanzas')); return null }
    return response.json()
  }).then((value) => { if (value) { setData({ ...EMPTY, ...value }); setError('') } }).catch(() => setError(mensajeDeFallo(null, 'ver las cifras de Finanzas'))), [buscado])

  useEffect(() => { void load() }, [load])

  /** Buscar es recargar con `q`: el filtro lo aplica el servidor sobre todo el histórico. */
  function buscar(termino: string) {
    setBuscado(termino)
    void load(termino)
  }

  async function act(url: string, options: RequestInit, fallback: string) {
    const response = await fetch(url, options)
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) { setMessage(body.error ?? fallback); return }
    setMessage('')
    void load()
  }

  const markPaid = (id: string) => act('/api/admin/payments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status: 'PAID' }) }, 'No se pudo marcar como cobrado')
  async function confirmDelete() {
    if (!pendingDelete) return
    const urls = { payment: `/api/admin/payments?id=${pendingDelete.id}`, expense: `/api/admin/expenses?id=${pendingDelete.id}`, quote: `/api/admin/quotes?id=${pendingDelete.id}` }
    const fallbacks = { payment: 'No se pudo eliminar el cobro', expense: 'No se pudo eliminar el gasto', quote: 'No se pudo eliminar el presupuesto' }
    await act(urls[pendingDelete.kind], { method: 'DELETE' }, fallbacks[pendingDelete.kind])
    setPendingDelete(null)
  }
  const setQuoteStatus = (id: string, status: string) => act('/api/admin/quotes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, status }) }, 'No se pudo actualizar el presupuesto')

  const day = (value: string) => formatInZone(new Date(value), data.timezone, { day: 'numeric', month: 'short' })

  return <>
    {modal === 'quote' && <NewQuoteModal onClose={() => setModal(null)} onCreated={load}/>}
    {modal === 'payment' && <NewPaymentModal onClose={() => setModal(null)} onCreated={load}/>}
    {modal === 'expense' && <NewExpenseModal onClose={() => setModal(null)} onCreated={load}/>}
    {ficha && <FinanceDetailModal
      ficha={ficha}
      negocio={{ name: data.business?.name ?? '', currency: data.currency, timezone: data.timezone, ...(data.business ?? {}) }}
      onClose={() => setFicha(null)}
      onCambio={() => void load()}
      onEliminar={() => {
        const kind = ficha.tipo === 'cobro' ? 'payment' : ficha.tipo === 'gasto' ? 'expense' : 'quote'
        const detalle = ficha.tipo === 'gasto'
          ? `${ficha.datos.description} · ${money(Number(ficha.datos.amount ?? 0), data.currency)}`
          : `${ficha.datos.client?.full_name ?? 'Cliente'} · ${money(Number(ficha.datos.amount ?? ficha.datos.total ?? 0), data.currency)}`
        setPendingDelete({ kind, id: String(ficha.datos.id), detail: detalle })
        setFicha(null)
      }}
    />}
    {pendingDelete && <ConfirmDeleteModal
      title={pendingDelete.kind === 'payment' ? 'Eliminar cobro' : pendingDelete.kind === 'expense' ? 'Eliminar gasto' : 'Eliminar presupuesto'}
      description={pendingDelete.kind === 'payment' ? 'El cobro desaparece del registro y deja de contar en las ventas del mes.' : pendingDelete.kind === 'expense' ? 'El gasto desaparece del registro y deja de descontarse del resultado.' : 'El presupuesto y sus ítems se borran. Si ya tiene un cobro asociado, no se podrá eliminar.'}
      detail={pendingDelete.detail}
      onCancel={() => setPendingDelete(null)}
      onConfirm={confirmDelete}
    />}

    <PageHeader title="Finanzas" description="Ventas, costos, anticipos, comisiones y rentabilidad real." action={<div className="flex flex-wrap gap-2">
      <button onClick={() => setModal('payment')} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Registrar cobro</button>
      <button onClick={() => setModal('expense')} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Registrar gasto</button>
      <button onClick={() => setModal('quote')} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Nuevo presupuesto</button>
    </div>}/>

    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {message && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Ventas del mes" value={money(data.sales, data.currency)} detail="Cobros confirmados" icon={CircleDollarSign}/>
      <StatCard label="Por cobrar" value={money(data.receivable, data.currency)} detail={`${data.pendingPayments.length} pendientes`} icon={HandCoins} tone="#ff9f43"/>
      <StatCard label="Costos y comisiones" value={money(data.directCosts + data.commissions, data.currency)} detail={`Materiales ${money(data.directCosts, data.currency)}`} icon={PackageOpen} tone="#ff6f91"/>
      <StatCard label="Resultado neto" value={money(data.net, data.currency)} detail={`Gastos operativos: ${money(data.operatingExpenses, data.currency)}`} icon={TrendingUp} tone="#17b890"/>
    </section>

    <div className="mt-6 flex flex-wrap items-center gap-2">
      {TABS.map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === value ? 'bg-[#5b3df5] text-white' : 'border bg-white'}`}>{label}</button>)}
      <form
        onSubmit={(evento) => { evento.preventDefault(); buscar(busqueda.trim()) }}
        className="ml-auto flex items-center gap-2"
      >
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#736f83]" />
          <input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar por nombre o teléfono…"
            aria-label="Buscar en finanzas"
            className="w-64 rounded-xl border py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <button className="rounded-xl border px-4 py-2 text-sm font-bold">Buscar</button>
        {buscado && <button type="button" onClick={() => { setBusqueda(''); buscar('') }} className="rounded-xl border px-3 py-2 text-sm font-bold">Limpiar</button>}
      </form>
    </div>
    {buscado && <p className="mt-3 text-sm text-[#736f83]">Mostrando resultados para <b>{buscado}</b> en todo el histórico.</p>}

    {tab === 'cobros' && <section className="mt-4 space-y-6">
      {data.pendingPayments.length > 0 && <article className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
        <h2 className="font-extrabold">Por cobrar</h2>
        <div className="mt-4 space-y-2">{data.pendingPayments.map((payment) => <div key={payment.id} role="button" tabIndex={0} onKeyDown={(evento)=>{if(evento.key==='Enter'||evento.key===' '){evento.preventDefault();evento.currentTarget.click()}}} onClick={() => setFicha({ tipo: 'cobro', datos: payment })} className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 hover:ring-2 hover:ring-[#5b3df5]/30">
          <div><b className="text-sm">{payment.client?.full_name ?? 'Cliente'}</b><p className="text-xs text-[#736f83]">{day(payment.created_at)}</p></div>
          <div className="flex items-center gap-3">
            <b className="text-sm">{money(Number(payment.amount), data.currency)}</b>
            <button onClick={(evento) => { evento.stopPropagation(); void markPaid(payment.id) }} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">Marcar cobrado</button>
            <button aria-label="Eliminar" onClick={(evento) => { evento.stopPropagation(); setPendingDelete({ kind: 'payment', id: payment.id, detail: `${payment.client?.full_name ?? 'Cliente'} · ${money(Number(payment.amount), data.currency)}` }) }} className="rounded-lg border border-red-200 p-1.5 text-red-700"><Trash2 size={14}/></button>
          </div>
        </div>)}</div>
      </article>}
      <article className="rounded-2xl border bg-white p-5">
        <h2 className="font-extrabold">Cobros registrados</h2>
        <div className="mt-4 space-y-2">
          {data.recentPayments.map((payment) => <div key={payment.id} role="button" tabIndex={0} onKeyDown={(evento)=>{if(evento.key==='Enter'||evento.key===' '){evento.preventDefault();evento.currentTarget.click()}}} onClick={() => setFicha({ tipo: 'cobro', datos: payment })} className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f6fa] p-3 hover:ring-2 hover:ring-[#5b3df5]/30">
            <div><b className="text-sm">{payment.client?.full_name ?? 'Cliente'}</b><p className="text-xs text-[#736f83]">{payment.paid_at ? day(payment.paid_at) : day(payment.created_at)} · {payment.method ?? 'Efectivo'}</p></div>
            <div className="flex items-center gap-3"><b className="text-sm">{money(Number(payment.amount), data.currency)}</b><button aria-label="Eliminar" onClick={(evento) => { evento.stopPropagation(); setPendingDelete({ kind: 'payment', id: payment.id, detail: `${payment.client?.full_name ?? 'Cliente'} · ${money(Number(payment.amount), data.currency)}` }) }} className="rounded-lg border border-red-200 p-1.5 text-red-700"><Trash2 size={14}/></button></div>
          </div>)}
          {!error && data.recentPayments.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Todavía no hay cobros registrados este mes.</p>}
        </div>
      </article>
    </section>}

    {tab === 'gastos' && <section className="mt-4 rounded-2xl border bg-white p-5">
      <h2 className="font-extrabold">Gastos</h2>
      <div className="mt-4 space-y-2">
        {data.recentExpenses.map((expense) => <div key={expense.id} role="button" tabIndex={0} onKeyDown={(evento)=>{if(evento.key==='Enter'||evento.key===' '){evento.preventDefault();evento.currentTarget.click()}}} onClick={() => setFicha({ tipo: 'gasto', datos: expense })} className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f6fa] p-3 hover:ring-2 hover:ring-[#5b3df5]/30">
          <div><b className="text-sm">{expense.description}</b><p className="text-xs text-[#736f83]">{expense.category} · {formatInZone(new Date(`${expense.incurred_on}T12:00:00Z`), data.timezone, { day: 'numeric', month: 'short' })}</p></div>
          <div className="flex items-center gap-3"><b className="text-sm">{money(Number(expense.amount), data.currency)}</b><button aria-label="Eliminar" onClick={(evento) => { evento.stopPropagation(); setPendingDelete({ kind: 'expense', id: expense.id, detail: `${expense.description} · ${money(Number(expense.amount), data.currency)}` }) }} className="rounded-lg border border-red-200 p-1.5 text-red-700"><Trash2 size={14}/></button></div>
        </div>)}
        {!error && data.recentExpenses.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Todavía no hay gastos registrados.</p>}
      </div>
    </section>}

    {tab === 'presupuestos' && <section className="mt-4 rounded-2xl border bg-white p-5">
      <h2 className="font-extrabold">Presupuestos</h2>
      <div className="mt-4 space-y-3">
        {data.quotes.map((quote) => <div key={quote.id} role="button" tabIndex={0} onKeyDown={(evento)=>{if(evento.key==='Enter'||evento.key===' '){evento.preventDefault();evento.currentTarget.click()}}} onClick={() => setFicha({ tipo: 'presupuesto', datos: quote })} className="cursor-pointer rounded-xl bg-[#f7f6fa] p-3 hover:ring-2 hover:ring-[#5b3df5]/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><b className="block text-sm">{quote.client?.full_name ?? 'Cliente'}</b><small className="text-[#736f83]">{quote.quote_items?.map((item: any) => item.description).join(', ')}</small></div>
            <div className="text-right"><b className="block text-sm">{money(Number(quote.total), data.currency)}</b><small className="text-[#5b3df5]">{QUOTE_STATUS[quote.status] ?? quote.status}</small></div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {!['ACCEPTED', 'REJECTED', 'CONVERTED'].includes(quote.status) && <>
              <button onClick={(evento) => { evento.stopPropagation(); void setQuoteStatus(quote.id, 'SENT') }} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold">Marcar enviado</button>
              <button onClick={(evento) => { evento.stopPropagation(); void setQuoteStatus(quote.id, 'ACCEPTED') }} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">Aceptado</button>
              <button onClick={(evento) => { evento.stopPropagation(); void setQuoteStatus(quote.id, 'REJECTED') }} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700">Rechazado</button>
            </>}
            <button aria-label="Eliminar presupuesto" onClick={(evento) => { evento.stopPropagation(); setPendingDelete({ kind: 'quote', id: quote.id, detail: `${quote.client?.full_name ?? 'Cliente'} · ${money(Number(quote.total), data.currency)}` }) }} className="rounded-lg border border-red-200 bg-white p-1.5 text-red-700"><Trash2 size={14}/></button>
          </div>
        </div>)}
        {!error && data.quotes.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Aún no hay presupuestos.</p>}
      </div>
    </section>}
  </>
}
