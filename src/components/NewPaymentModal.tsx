'use client'

import { FormEvent, useEffect, useState } from 'react'
import { ModalShell } from '@/components/ModalShell'

const METHODS: Array<[string, string]> = [['EFECTIVO', 'Efectivo'], ['TARJETA', 'Tarjeta'], ['TRANSFERENCIA', 'Transferencia'], ['OTRO', 'Otro']]

export function NewPaymentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<Array<{ id: string; full_name: string; phone: string | null }>>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetch('/api/admin/clients').then((response) => response.json()).then((data) => setClients(data.clients ?? [])).catch(() => setError('No se pudo cargar la lista de clientes')) }, [])

  const visible = clients.filter((client) => `${client.full_name} ${client.phone ?? ''}`.toLowerCase().includes(query.toLowerCase()))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true); setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: form.get('clientId'), amount: Number(form.get('amount') || 0), method: form.get('method'), status: form.get('status'), reference: form.get('reference') }),
    })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo registrar el cobro'); return }
    onCreated()
    onClose()
  }

  return <ModalShell titulo="Registrar cobro" onClose={onClose}>
    <form onSubmit={submit} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">Registrar cobro</h2><p className="text-sm text-[#736f83]">Queda contado en las ventas del mes.</p></div>
      </div>
      <label className="mt-5 block text-sm font-semibold">Cliente
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o teléfono" className="mt-2 w-full rounded-xl border p-3"/>
        <select name="clientId" required className="mt-2 w-full rounded-xl border p-3"><option value="">Seleccionar</option>{visible.map((client) => <option key={client.id} value={client.id}>{client.full_name}{client.phone ? ` · ${client.phone}` : ''}</option>)}</select>
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Monto<input name="amount" type="number" min="1" step="1" required className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Método<select name="method" className="mt-2 w-full rounded-xl border p-3">{METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm font-semibold">Estado<select name="status" className="mt-2 w-full rounded-xl border p-3"><option value="PAID">Cobrado</option><option value="PENDING">Por cobrar</option></select></label>
        <label className="text-sm font-semibold">Referencia<input name="reference" placeholder="N° de boleta, transferencia…" className="mt-2 w-full rounded-xl border p-3"/></label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Guardando…' : 'Registrar cobro'}</button>
    </form>
  </ModalShell>
}
