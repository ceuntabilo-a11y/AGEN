'use client'

import { AlertTriangle, CalendarClock, CheckCircle2, MessageSquareText, TimerReset } from 'lucide-react'
import { useState } from 'react'
import { dateKeyInZone, formatInZone, formatTimeInZone, zonedDayRange } from '@/lib/timezone'
import { ModalShell } from '@/components/ModalShell'

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

type Coverage = { professional_id: string; professional_name: string; works: boolean; starts_at: string | null; ends_at: string | null }

/** Lo que está a punto de pasar, en palabras, antes de tocar la reserva. */
type PendingChange = {
  action: 'reschedule' | 'resize' | 'cancel'
  title: string
  intro: string
  rows: Array<{ label: string; before?: string; after: string }>
  body: Record<string, unknown>
  danger?: boolean
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

function longDateTime(value: string, timezone: string) {
  const date = formatInZone(value, timezone, { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')
  return `${date} a las ${formatTimeInZone(value, timezone)}`
}

function minutesBetween(start: string, end: string) {
  return Math.max(5, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000))
}

export function AppointmentDetailsModal({ appointment, timezone, onClose, onUpdated, endpoint = '/api/admin/agenda' }: { appointment: AgendaAppointment; timezone: string; onClose: () => void; onUpdated: () => void; endpoint?: string }) {
  const originalDuration = minutesBetween(appointment.start, appointment.end)
  const [date, setDate] = useState(dateKeyInZone(appointment.start, timezone))
  const [slots, setSlots] = useState<Slot[]>([])
  const [coverage, setCoverage] = useState<Coverage[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [selectedStart, setSelectedStart] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState(originalDuration)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const canModify = !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status)
  const myCoverage = coverage?.find((item) => item.professional_id === appointment.professionalId) ?? null
  const workingToday = coverage?.filter((item) => item.works) ?? []
  const chosenDayLabel = formatInZone(`${date}T12:00:00Z`, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')

  function fail(message: string) {
    setSaved('')
    setError(message)
  }

  /** Pide el motivo primero y luego muestra en pantalla el cambio exacto que se va a aplicar. */
  function propose(change: Omit<PendingChange, 'body'> & { body: Record<string, unknown> }) {
    if (!reason.trim()) {
      fail('Escribe el motivo del cambio: se le explicará al cliente en el aviso que recibirá.')
      return
    }
    setError('')
    setSaved('')
    setPending(change)
  }

  async function apply() {
    if (!pending) return
    setLoading(true)
    setError('')
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appointmentId: appointment.id, action: pending.action, reason: reason.trim(), ...pending.body }),
    })
    const data = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) {
      setPending(null)
      fail(data.error ?? 'No se pudo actualizar la reserva')
      return
    }
    setPending(null)
    setSaved(appointment.phone
      ? 'Cambio guardado. El cliente recibirá el aviso por WhatsApp con el motivo.'
      : 'Cambio guardado. El cliente no tiene teléfono registrado, así que no se le pudo avisar.')
    onUpdated()
    setTimeout(onClose, 1800)
  }

  async function changeStatus(status: string) {
    setLoading(true)
    setError('')
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appointmentId: appointment.id, action: 'status', status }),
    })
    const data = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) { fail(data.error ?? 'No se pudo actualizar la reserva'); return }
    setSaved(`Estado actualizado a “${labels[status] ?? status}”.`)
    onUpdated()
    setTimeout(onClose, 1200)
  }

  async function searchSlots() {
    setError('')
    setSaved('')
    setSelectedStart('')
    setSearched(false)
    const { from, until } = zonedDayRange(date, timezone)
    const response = await fetch('/api/admin/slots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceId: appointment.serviceId, from, until }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) { fail(data.error ?? 'No se pudo buscar disponibilidad'); return }
    setCoverage(data.coverage ?? [])
    setSlots((data.slots ?? []).filter((slot: Slot) => slot.professional_id === appointment.professionalId))
    setSearched(true)
  }

  const alert = error
    ? { tone: 'error' as const, text: error }
    : saved
      ? { tone: 'ok' as const, text: saved }
      : null

  return <ModalShell titulo="Detalle de la reserva" onClose={onClose}>
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#f8f7fb] shadow-2xl">

      <div className="sticky top-0 z-10 rounded-t-3xl bg-[#f8f7fb] px-6 pb-2 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#736f83]">
              {labels[appointment.status] ?? appointment.status}
              {appointment.confirmedByClient && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Confirmada por el cliente</span>}
            </p>
            <h2 className="mt-1 text-2xl font-black">{appointment.client}</h2>
            <p className="text-sm text-[#736f83]">{appointment.serviceName} · {appointment.professionalName}</p>
          </div>
        </div>

        {alert && <div role="alert" className={`mt-4 flex items-start gap-3 rounded-2xl border-2 p-4 text-sm font-bold ${alert.tone === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
          {alert.tone === 'error' ? <AlertTriangle size={20} className="shrink-0"/> : <CheckCircle2 size={20} className="shrink-0"/>}
          <span>{alert.text}</span>
        </div>}
      </div>

      <div className="px-6 pb-6">

      {pending && <section className="mb-4 rounded-2xl border-2 border-[#5b3df5] bg-white p-5">
        <h3 className="text-lg font-black">{pending.title}</h3>
        <p className="mt-1 text-sm text-[#4b4560]">{pending.intro}</p>
        <dl className="mt-4 space-y-2 rounded-xl bg-[#f3f0ff] p-4 text-sm">
          {pending.rows.map((row) => <div key={row.label} className="flex flex-wrap items-baseline gap-2">
            <dt className="w-28 shrink-0 font-bold text-[#5b4b8a]">{row.label}</dt>
            <dd className="flex-1">
              {row.before && <><span className="text-[#736f83] line-through">{row.before}</span><span className="mx-2">→</span></>}
              <b>{row.after}</b>
            </dd>
          </div>)}
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-28 shrink-0 font-bold text-[#5b4b8a]">Motivo</dt>
            <dd className="flex-1"><b>{reason.trim()}</b></dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-[#736f83]">{appointment.phone ? `Se le enviará un WhatsApp a ${appointment.client} (${appointment.phone}) con este cambio y el motivo.` : 'El cliente no tiene teléfono registrado: no recibirá aviso.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={loading} onClick={apply} className={`rounded-xl px-5 py-3 font-bold text-white disabled:opacity-50 ${pending.danger ? 'bg-red-700' : 'bg-[#5b3df5]'}`}>{loading ? 'Guardando…' : 'Sí, aplicar el cambio'}</button>
          <button disabled={loading} onClick={() => setPending(null)} className="rounded-xl border bg-white px-5 py-3 font-bold disabled:opacity-50">Volver</button>
        </div>
      </section>}

      <section className="rounded-2xl border bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="text-xs font-semibold text-[#736f83]">Fecha</span><b className="mt-1 block capitalize">{formatInZone(appointment.start, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b></div>
          <div><span className="text-xs font-semibold text-[#736f83]">Horario</span><b className="mt-1 block">{formatTimeInZone(appointment.start, timezone)}–{formatTimeInZone(appointment.end, timezone)} · {originalDuration} min</b></div>
          {appointment.phone && <div><span className="text-xs font-semibold text-[#736f83]">Teléfono</span><b className="mt-1 block">{appointment.phone}</b></div>}
          {appointment.notes && <div><span className="text-xs font-semibold text-[#736f83]">Notas</span><p className="mt-1 text-sm">{appointment.notes}</p></div>}
        </div>
        {(nextActions[appointment.status] ?? []).length > 0 && !pending && <div className="mt-5 flex flex-wrap gap-2">{nextActions[appointment.status].map((action) => <button key={action.status} disabled={loading} onClick={() => changeStatus(action.status)} className={`rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-50 ${action.style}`}>{action.label}</button>)}</div>}
      </section>

      {canModify && !pending && <>
        <section className="mt-4 rounded-2xl border border-[#5b3df5]/30 bg-[#f3f0ff] p-5">
          <div className="flex items-center gap-2"><MessageSquareText size={18} className="text-[#5b3df5]"/><h3 className="font-extrabold">Motivo del cambio *</h3></div>
          <p className="mt-1 text-xs text-[#5b4b8a]">Obligatorio para reagendar, cambiar la duración o cancelar. El cliente lo recibe por WhatsApp junto con el cambio.</p>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} placeholder="Ej: la profesional tuvo una urgencia médica" className={`mt-3 w-full rounded-xl border-2 p-3 text-sm ${error && !reason.trim() ? 'border-red-400' : 'border-transparent bg-white'}`}/>
        </section>

        <section className="mt-4 rounded-2xl border bg-white p-5">
          <div className="flex items-center gap-2"><CalendarClock size={18} className="text-[#5b3df5]"/><h3 className="font-extrabold">Cambiar el día y la hora</h3></div>
          <p className="mt-1 text-xs text-[#736f83]">Sigue con {appointment.professionalName}. Agen revalida el horario al confirmar.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSlots([]); setSelectedStart(''); setSearched(false); setCoverage(null) }} className="rounded-xl border p-3"/>
            <button onClick={searchSlots} className="rounded-xl border border-[#5b3df5] px-4 py-3 text-sm font-bold text-[#5b3df5]">Buscar horas</button>
          </div>

          {searched && coverage && <div className="mt-3">
            {coverage.length > 0 && coverage.every((item) => !item.works)
              ? <p className="flex items-start gap-2 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle size={18} className="shrink-0"/><span>El {chosenDayLabel} no atiende nadie para {appointment.serviceName}. Elige otro día.</span></p>
              : myCoverage && !myCoverage.works
                ? <p className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900"><AlertTriangle size={18} className="shrink-0"/><span>{appointment.professionalName} no atiende el {chosenDayLabel}. Ese día atienden: {workingToday.map((item) => item.professional_name).join(', ')}. Para cambiar de profesional arrastra la reserva en la agenda.</span></p>
                : slots.length === 0
                  ? <p className="flex items-start gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900"><AlertTriangle size={18} className="shrink-0"/><span>{appointment.professionalName} atiende el {chosenDayLabel}{myCoverage?.starts_at ? ` de ${myCoverage.starts_at.slice(0, 5)} a ${myCoverage.ends_at?.slice(0, 5)}` : ''}, pero no le queda ninguna hora libre.</span></p>
                  : null}
          </div>}

          {slots.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{slots.map((slot) => <button key={slot.service_start} onClick={() => setSelectedStart(slot.service_start)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${selectedStart === slot.service_start ? 'border-[#5b3df5] bg-[#5b3df5] text-white' : 'bg-white'}`}>{formatTimeInZone(slot.service_start, timezone)}</button>)}</div>}

          {selectedStart && <button
            disabled={loading}
            onClick={() => propose({
              action: 'reschedule',
              title: '¿Confirmas el cambio de día y hora?',
              intro: `Vas a mover la hora de ${appointment.client}.`,
              rows: [
                { label: 'Cuándo', before: longDateTime(appointment.start, timezone), after: longDateTime(selectedStart, timezone) },
                { label: 'Profesional', after: appointment.professionalName },
                { label: 'Servicio', after: `${appointment.serviceName} · ${originalDuration} min` },
              ],
              body: { newStart: selectedStart },
            })}
            className="mt-4 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">Revisar el cambio de hora</button>}
        </section>

        <section className="mt-4 rounded-2xl border bg-white p-5">
          <div className="flex items-center gap-2"><TimerReset size={18} className="text-[#5b3df5]"/><h3 className="font-extrabold">Cambiar solo la duración</h3></div>
          <p className="mt-1 text-xs text-[#736f83]">El día y la hora de inicio no se tocan: solo cuánto dura la atención.</p>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" onClick={() => setDuration((value) => Math.max(5, value - 15))} className="rounded-xl border px-4 py-2 font-bold">−15</button>
            <b className="min-w-24 text-center">{duration} min{duration === originalDuration ? '' : ` (antes ${originalDuration})`}</b>
            <button type="button" onClick={() => setDuration((value) => Math.min(1440, value + 15))} className="rounded-xl border px-4 py-2 font-bold">+15</button>
            <button
              disabled={loading || duration === originalDuration}
              title={duration === originalDuration ? 'La duración es la misma: no hay nada que cambiar' : undefined}
              onClick={() => propose({
                action: 'resize',
                title: '¿Confirmas el cambio de duración?',
                intro: `La hora de ${appointment.client} sigue el mismo día, solo cambia cuánto dura.`,
                rows: [
                  { label: 'Cuándo', after: longDateTime(appointment.start, timezone) },
                  { label: 'Duración', before: `${originalDuration} min`, after: `${duration} min` },
                ],
                body: { durationMinutes: duration },
              })}
              className="ml-auto rounded-xl bg-[#5b3df5] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Revisar</button>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-red-100 bg-white p-5">
          <h3 className="font-extrabold text-red-800">Cancelar la reserva</h3>
          <p className="mt-1 text-xs text-[#736f83]">El cliente recibe el aviso con el motivo y el cupo se ofrece a la lista de espera.</p>
          <button
            disabled={loading}
            onClick={() => propose({
              action: 'cancel',
              danger: true,
              title: '¿Confirmas la cancelación?',
              intro: `Vas a cancelar la hora de ${appointment.client}. El horario queda libre.`,
              rows: [
                { label: 'Cuándo', after: longDateTime(appointment.start, timezone) },
                { label: 'Profesional', after: appointment.professionalName },
                { label: 'Servicio', after: appointment.serviceName },
              ],
              body: {},
            })}
            className="mt-3 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Cancelar y avisar</button>
        </section>
      </>}
      </div>
    </div>
  </ModalShell>
}
