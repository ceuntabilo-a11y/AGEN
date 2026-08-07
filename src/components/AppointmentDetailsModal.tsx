'use client'

import { CalendarClock, MessageSquareText, TimerReset, X } from 'lucide-react'
import { useState } from 'react'
import { dateKeyInZone, formatInZone, formatTimeInZone, zonedDayRange } from '@/lib/timezone'

export type AgendaAppointment = {
  id: string
  start: string
  end: string
  client: string
  phone?: string | null
  professionalId: string
  professionalName: string
  professionalColor: string
  serviceId: string
  serviceName: string
  status: string
  notes?: string | null
  confirmedByClient?: boolean
}

type Slot = {
  professional_id: string
  professional_name: string
  service_start: string
  service_end: string
}

const labels: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CHECKED_IN: 'Cliente llegó',
  IN_PROGRESS: 'En atención',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
}

const nextActions: Record<string, Array<{ status: string; label: string; style: string }>> = {
  PENDING: [
    { status: 'CONFIRMED', label: 'Confirmar', style: 'bg-violet-600 text-white' },
    { status: 'CHECKED_IN', label: 'Cliente llegó', style: 'bg-white' },
    { status: 'NO_SHOW', label: 'No asistió', style: 'bg-white text-red-700' },
  ],
  CONFIRMED: [
    { status: 'CHECKED_IN', label: 'Cliente llegó', style: 'bg-violet-600 text-white' },
    { status: 'NO_SHOW', label: 'No asistió', style: 'bg-white text-red-700' },
  ],
  CHECKED_IN: [{ status: 'IN_PROGRESS', label: 'Iniciar atención', style: 'bg-violet-600 text-white' }],
  IN_PROGRESS: [{ status: 'COMPLETED', label: 'Completar', style: 'bg-emerald-600 text-white' }],
}

export function AppointmentDetailsModal({ appointment, timezone, onClose, onUpdated }: { appointment: AgendaAppointment; timezone: string; onClose: () => void; onUpdated: () => void }) {
  const [date, setDate] = useState(dateKeyInZone(appointment.start, timezone))
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedStart, setSelectedStart] = useState('')
  const [reason, setReason] = useState('')
  const [duration,setDuration]=useState(Math.max(5,Math.round((new Date(appointment.end).getTime()-new Date(appointment.start).getTime())/60000)))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Cualquier cambio se le avisa al cliente por WhatsApp con el motivo: sin motivo no se guarda.
  const CHANGE_ACTIONS = ['cancel', 'reschedule', 'resize']

  async function update(body: Record<string, unknown>) {
    if (CHANGE_ACTIONS.includes(String(body.action)) && !reason.trim()) {
      setError('Escribe el motivo del cambio: se le explicará al cliente en el aviso')
      return
    }
    setLoading(true)
    setError('')
    const payload = CHANGE_ACTIONS.includes(String(body.action)) ? { reason: reason.trim(), ...body } : body
    const response = await fetch('/api/admin/agenda', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appointmentId: appointment.id, ...payload }) })
    const data = await response.json()
    if (!response.ok) {
      setError(data.error ?? 'No se pudo actualizar la reserva')
      setLoading(false)
      return
    }
    onUpdated()
    onClose()
  }

  async function searchSlots() {
    setError('')
    setSelectedStart('')
    const { from, until } = zonedDayRange(date, timezone)
    const response = await fetch('/api/admin/slots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId: appointment.serviceId, from, until }) })
    const data = await response.json()
    if (!response.ok) {
      setError(data.error ?? 'No se pudo buscar disponibilidad')
      return
    }
    setSlots((data.slots ?? []).filter((slot: Slot) => slot.professional_id === appointment.professionalId))
  }

  async function cancel() {
    if (!window.confirm('¿Confirmas la cancelación? El horario quedará libre y se generará el aviso al cliente.')) return
    await update({ action: 'cancel' })
  }

  const canModify = !['COMPLETED','CANCELLED','NO_SHOW'].includes(appointment.status)

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#f8f7fb] p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-wide text-[#736f83]">{labels[appointment.status] ?? appointment.status}{appointment.confirmedByClient && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Confirmada por el cliente</span>}</p><h2 className="mt-1 text-2xl font-black">{appointment.client}</h2><p className="text-sm text-[#736f83]">{appointment.serviceName} · {appointment.professionalName}</p></div>
        <button aria-label="Cerrar" onClick={onClose} className="rounded-xl bg-white p-2"><X/></button>
      </div>

      <section className="mt-5 rounded-2xl border bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="text-xs font-semibold text-[#736f83]">Fecha</span><b className="mt-1 block capitalize">{formatInZone(appointment.start, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b></div>
          <div><span className="text-xs font-semibold text-[#736f83]">Horario</span><b className="mt-1 block">{formatTimeInZone(appointment.start, timezone)}–{formatTimeInZone(appointment.end, timezone)}</b></div>
          {appointment.phone && <div><span className="text-xs font-semibold text-[#736f83]">Teléfono</span><b className="mt-1 block">{appointment.phone}</b></div>}
          {appointment.notes && <div><span className="text-xs font-semibold text-[#736f83]">Notas</span><p className="mt-1 text-sm">{appointment.notes}</p></div>}
        </div>
        {(nextActions[appointment.status] ?? []).length > 0 && <div className="mt-5 flex flex-wrap gap-2">{nextActions[appointment.status].map((action) => <button key={action.status} disabled={loading} onClick={() => update({ action: 'status', status: action.status })} className={`rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50 ${action.style}`}>{action.label}</button>)}</div>}
      </section>

      {canModify && <section className="mt-4 rounded-2xl border border-[#5b3df5]/30 bg-[#f3f0ff] p-5">
        <div className="flex items-center gap-2"><MessageSquareText size={18} className="text-[#5b3df5]"/><h3 className="font-extrabold">Motivo del cambio *</h3></div>
        <p className="mt-1 text-xs text-[#5b4b8a]">Obligatorio para reagendar, cambiar la duración o cancelar. El cliente lo recibe por WhatsApp junto con el cambio.</p>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} placeholder="Ej: la profesional tuvo una urgencia médica" className="mt-3 w-full rounded-xl border p-3 text-sm"/>
      </section>}

      {canModify && <section className="mt-4 rounded-2xl border bg-white p-5">
        <div className="flex items-center gap-2"><CalendarClock size={18} className="text-[#5b3df5]"/><h3 className="font-extrabold">Reagendar con el mismo profesional</h3></div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSlots([]); setSelectedStart('') }} className="rounded-xl border p-3"/><button onClick={searchSlots} className="rounded-xl border border-[#5b3df5] px-4 py-3 text-sm font-bold text-[#5b3df5]">Buscar horas</button></div>
        {slots.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{slots.map((slot) => <button key={slot.service_start} onClick={() => setSelectedStart(slot.service_start)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${selectedStart === slot.service_start ? 'border-[#5b3df5] bg-[#5b3df5] text-white' : 'bg-white'}`}>{formatTimeInZone(slot.service_start, timezone)}</button>)}</div>}
        {selectedStart && <button disabled={loading} onClick={() => update({ action: 'reschedule', newStart: selectedStart })} className="mt-4 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">Confirmar nueva hora</button>}
      </section>}

      {canModify && <section className="mt-4 rounded-2xl border bg-white p-5"><div className="flex items-center gap-2"><TimerReset size={18} className="text-[#5b3df5]"/><h3 className="font-extrabold">Ajustar duración</h3></div><p className="mt-1 text-xs text-[#736f83]">Agen comprueba nuevamente el horario, los bloqueos y los recursos.</p><div className="mt-4 flex items-center gap-3"><button type="button" onClick={()=>setDuration(value=>Math.max(5,value-15))} className="rounded-xl border px-4 py-2 font-bold">−15</button><b className="min-w-20 text-center">{duration} min</b><button type="button" onClick={()=>setDuration(value=>Math.min(1440,value+15))} className="rounded-xl border px-4 py-2 font-bold">+15</button><button disabled={loading} onClick={()=>update({action:'resize',durationMinutes:duration})} className="ml-auto rounded-xl bg-[#5b3df5] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button></div></section>}

      {canModify && <section className="mt-4 rounded-2xl border border-red-100 bg-white p-5"><h3 className="font-extrabold text-red-800">Cancelar reserva</h3><p className="mt-1 text-xs text-[#736f83]">El cliente recibe el aviso con el motivo y el cupo se ofrece a la lista de espera.</p><button disabled={loading} onClick={cancel} className="mt-3 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Cancelar y avisar</button></section>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  </div>
}
