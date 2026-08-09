'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { dateKeyInZone, formatInZone, formatTimeInZone, zonedDayRange } from '@/lib/timezone'
import { ModalShell } from '@/components/ModalShell'

type Catalog = { services: Array<{ id: string; name: string; price: number }>; professionals: Array<{ id: string; display_name: string }>; branches: Array<{ id: string; name: string }> }
type Client = { id: string; full_name: string; phone: string | null }
type Slot = { professional_id: string; professional_name: string; service_start: string; service_end: string; quoted_price: number }
type Coverage = { professional_id: string; professional_name: string; works: boolean; starts_at: string | null; ends_at: string | null }

export function NewAppointmentModal({ onClose, onCreated, timezone = 'America/Santiago', initialDate, initialClientId }: { onClose: () => void; onCreated: () => void; timezone?: string; initialDate?: string; initialClientId?: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [clientQuery, setClientQuery] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [clientId, setClientId] = useState(initialClientId ?? '')
  const [date, setDate] = useState(initialDate ?? dateKeyInZone(new Date(), timezone))
  const [slots, setSlots] = useState<Slot[]>([])
  const [coverage, setCoverage] = useState<Coverage[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [slot, setSlot] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([fetch('/api/admin/catalog').then((r) => r.json()), fetch('/api/admin/clients').then((r) => r.json())])
      .then(([c, p]) => { setCatalog(c); setClients(p.clients ?? []) })
  }, [])

  const dayLabel = formatInZone(`${date}T12:00:00Z`, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')
  const workingToday = coverage?.filter((item) => item.works) ?? []
  const dayOff = Boolean(coverage && coverage.length > 0 && workingToday.length === 0)

  function resetSearch() {
    setSlots([]); setSlot(null); setSearched(false); setCoverage(null); setError('')
  }

  async function search() {
    setError(''); setSlot(null); setSearched(false)
    const { from, until } = zonedDayRange(date, timezone)
    const response = await fetch('/api/admin/slots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId, from, until }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { setError(data.error ?? 'No se pudo buscar disponibilidad'); return }
    setCoverage(data.coverage ?? [])
    setSlots(data.slots ?? [])
    setSearched(true)
  }

  async function create() {
    if (!slot || !clientId || !catalog) return
    setLoading(true); setError('')
    const response = await fetch('/api/admin/agenda', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branchId: catalog.branches[0]?.id ?? null, clientId, professionalId: slot.professional_id, serviceId, desiredStart: slot.service_start }) })
    const data = await response.json().catch(() => ({}))
    if (response.status === 409) { setError('Ese horario acaba de ocuparse. Elige otro de la lista actualizada.'); setSlot(null); await search(); setLoading(false); return }
    if (!response.ok) { setError(data.error ?? 'No se pudo reservar'); setLoading(false); return }
    onCreated(); onClose()
  }

  const visibleClients = clients.filter((client) => `${client.full_name} ${client.phone ?? ''}`.toLowerCase().includes(clientQuery.toLowerCase()))

  return <ModalShell titulo="Nueva reserva" onClose={onClose}>
    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-black">Nueva reserva</h2><p className="text-sm text-[#736f83]">La hora se revalida al confirmar.</p></div>
        <button aria-label="Cerrar" onClick={onClose} className="rounded-lg p-2 hover:bg-black/5"><X/></button>
      </div>

      {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800"><AlertTriangle size={20} className="shrink-0"/><span>{error}</span></p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Cliente
          <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Buscar por nombre o teléfono" className="mt-2 w-full rounded-xl border p-3"/>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">Seleccionar</option>{visibleClients.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.phone ? ` · ${c.phone}` : ''}</option>)}</select>
        </label>
        <label className="text-sm font-semibold">Servicio
          <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); resetSearch() }} className="mt-2 w-full rounded-xl border p-3"><option value="">Seleccionar</option>{catalog?.services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
        <label className="text-sm font-semibold">Fecha
          <input type="date" min={dateKeyInZone(new Date(), timezone)} value={date} onChange={(e) => { setDate(e.target.value); resetSearch() }} className="mt-2 w-full rounded-xl border p-3"/>
        </label>
        <button disabled={!serviceId} onClick={search} className="self-end rounded-xl border border-[#5b3df5] p-3 font-bold text-[#5b3df5] disabled:opacity-40">Buscar disponibilidad</button>
      </div>

      {searched && dayOff && <p role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800"><AlertTriangle size={20} className="shrink-0"/><span>El {dayLabel} no atiende nadie para este servicio: no es un día laboral. Elige otra fecha.</span></p>}
      {searched && !dayOff && slots.length === 0 && <p role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900"><AlertTriangle size={20} className="shrink-0"/><span>El {dayLabel} atienden {workingToday.map((item) => item.professional_name).join(', ')}, pero no queda ninguna hora libre para este servicio.</span></p>}

      {slots.length > 0 && <div className="mt-5">
        <p className="mb-2 text-sm font-bold">Horas realmente disponibles el {dayLabel}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{slots.map((s) => <button key={`${s.professional_id}-${s.service_start}`} onClick={() => setSlot(s)} className={`rounded-xl border p-3 text-left text-sm ${slot === s ? 'border-[#5b3df5] bg-violet-50' : ''}`}><b>{formatTimeInZone(s.service_start, timezone)}</b><small className="block truncate text-[#736f83]">{s.professional_name}</small></button>)}</div>
      </div>}
      {!searched && serviceId && <p className="mt-5 text-sm text-[#736f83]">Selecciona “Buscar disponibilidad”.</p>}

      <button disabled={!slot || !clientId || loading} onClick={create} className="mt-6 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-40">{loading ? 'Confirmando…' : 'Confirmar reserva'}</button>
    </div>
  </ModalShell>
}
