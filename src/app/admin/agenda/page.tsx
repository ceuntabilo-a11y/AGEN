'use client'

import { PageHeader } from '@/components/PageHeader'
import { NewAppointmentModal } from '@/components/NewAppointmentModal'
import { AgendaAppointment, AppointmentDetailsModal } from '@/components/AppointmentDetailsModal'
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDaysToDateKey,
  dateKeyInZone,
  formatInZone,
  formatTimeInZone,
  startOfMonthDateKey,
  startOfWeekDateKey,
  zonedDateTimeToUtc,
  zonedParts,
} from '@/lib/timezone'

type Professional = { id: string; name: string; specialty: string; color: string }
type Hold = { id: string; start: string; end: string; expiresAt: string; client: string; professionalId: string; serviceName: string }
type View = 'day' | 'week' | 'month'
type Catalog = { business: { timezone: string } | null; specialties: Array<{ id: string; name: string }>; professionals: Array<any> }

const CELL_H = 64
const T_COL_W = 52
const WEEK_HEADS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const STATUS_META: Record<string, { label: string; bg: string; tx: string }> = {
  PENDING: { label: 'Pendiente', bg: '#eff6ff', tx: '#1d4ed8' },
  CONFIRMED: { label: 'Confirmada', bg: '#f0fdfa', tx: '#0f766e' },
  CHECKED_IN: { label: 'Cliente llegó', bg: '#f0f9ff', tx: '#0c4a6e' },
  IN_PROGRESS: { label: 'En atención', bg: '#fdf4ff', tx: '#7e22ce' },
  COMPLETED: { label: 'Completada', bg: '#f0fdf4', tx: '#15803d' },
  CANCELLED: { label: 'Cancelada', bg: '#fef2f2', tx: '#b91c1c' },
  NO_SHOW: { label: 'No asistió', bg: '#fffbeb', tx: '#78350f' },
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value
  const int = parseInt(full, 16)
  return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`
}
const round15 = (mins: number) => Math.round(mins / 15) * 15
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const fmtMins = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
function addMonths(dateKey: string, months: number) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10)
}
function rangeDates(range: string) {
  const parts = range.replace(/[\[\]()"]/g, '').split(',')
  return [new Date(parts[0]), new Date(parts[1])] as const
}
const isActiveStatus = (status: string) => ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(status)

export default function AgendaPage() {
  const [view, setView] = useState<View>('day')
  const [timezone, setTimezone] = useState('America/Santiago')
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newDate, setNewDate] = useState<string | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<AgendaAppointment | null>(null)
  const [revision, setRevision] = useState(0)
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [selected, setSelected] = useState('all')
  const [professionalQuery, setProfessionalQuery] = useState('')
  const [appointments, setAppointments] = useState<AgendaAppointment[]>([])
  const [holds, setHolds] = useState<Hold[]>([])
  const [dots, setDots] = useState<AgendaAppointment[]>([])
  const [porProfesional, setPorProfesional] = useState(true)
  const [hover, setHover] = useState<{ day: string; mins: number } | null>(null)
  const [dragged, setDragged] = useState<{ id: string; duration: number; offset: number } | null>(null)
  const [ghost, setGhost] = useState<{ day: string; mins: number; professionalId?: string } | null>(null)
  const [dropConfirm, setDropConfirm] = useState<{ id: string; day: string; mins: number; professionalId: string } | null>(null)
  const [dropReason, setDropReason] = useState('')
  const [noShowFor, setNoShowFor] = useState<AgendaAppointment | null>(null)
  const [noShowNotify, setNoShowNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /** Confirmación verde arriba de la agenda: se va sola a los pocos segundos. */
  function flash(message: string) {
    setError('')
    setSaved(message)
    setTimeout(() => setSaved(''), 6000)
  }

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    fetch('/api/admin/catalog').then(async (response) => {
      if (!response.ok) throw new Error('No se pudo cargar el equipo')
      return response.json() as Promise<Catalog>
    }).then((catalog) => {
      const businessTimezone = catalog.business?.timezone || 'America/Santiago'
      setTimezone(businessTimezone)
      setAnchor(dateKeyInZone(new Date(), businessTimezone))
      setProfessionals(catalog.professionals.map((professional: any) => ({
        id: professional.id,
        name: professional.display_name,
        specialty: (professional.professional_specialties?.[0] && catalog.specialties.find((specialty) => specialty.id === professional.professional_specialties[0].specialty_id)?.name) || 'Sin especialidad',
        color: professional.color || '#5b3df5',
      })))
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'No se pudo cargar la agenda'))
  }, [])

  const windowRange = useMemo(() => {
    if (view === 'day') return { first: anchor, until: addDaysToDateKey(anchor, 1) }
    if (view === 'week') {
      const first = startOfWeekDateKey(anchor)
      return { first, until: addDaysToDateKey(first, 7) }
    }
    const first = startOfMonthDateKey(anchor)
    return { first, until: addMonths(first, 1) }
  }, [anchor, view])

  useEffect(() => {
    const from = zonedDateTimeToUtc(windowRange.first, '00:00:00', timezone).toISOString()
    const until = zonedDateTimeToUtc(windowRange.until, '00:00:00', timezone).toISOString()
    setLoading(true)
    fetch(`/api/admin/agenda?from=${encodeURIComponent(from)}&until=${encodeURIComponent(until)}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('No se pudieron cargar las reservas')
      return response.json()
    }).then((agenda) => {
      setAppointments((agenda.appointments ?? []).map((appointment: any) => {
        const [start, end] = rangeDates(appointment.service_period)
        return {
          id: appointment.id,
          start: start.toISOString(),
          end: end.toISOString(),
          client: appointment.client?.full_name ?? 'Cliente',
          phone: appointment.client?.phone,
          professionalId: appointment.professional?.id,
          professionalName: appointment.professional?.display_name ?? 'Profesional',
          professionalColor: appointment.professional?.color ?? '#5b3df5',
          serviceId: appointment.service?.id,
          serviceName: appointment.service?.name ?? 'Servicio',
          status: appointment.status,
          notes: appointment.notes,
          confirmedByClient: Boolean(appointment.client_confirmed_at),
        }
      }))
      setHolds((agenda.holds ?? []).map((hold: any) => {
        const [occupiedStart, occupiedEnd] = rangeDates(hold.period)
        const start = new Date(occupiedStart.getTime() + Number(hold.service?.buffer_before_minutes ?? 0) * 60000)
        const end = new Date(occupiedEnd.getTime() - Number(hold.service?.buffer_after_minutes ?? 0) * 60000)
        return { id: hold.id, start: start.toISOString(), end: end.toISOString(), expiresAt: hold.expires_at, client: hold.client?.full_name ?? hold.contact_key ?? 'Cliente', professionalId: hold.professional?.id, serviceName: hold.service?.name ?? 'Servicio' }
      }))
      setError('')
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'No se pudo cargar la agenda')).finally(() => setLoading(false))
  }, [revision, timezone, windowRange.first, windowRange.until])

  useEffect(() => {
    const today = dateKeyInZone(new Date(), timezone)
    const from = zonedDateTimeToUtc(addMonths(today, -2), '00:00:00', timezone).toISOString()
    const until = zonedDateTimeToUtc(addMonths(today, 5), '00:00:00', timezone).toISOString()
    fetch(`/api/admin/agenda?from=${encodeURIComponent(from)}&until=${encodeURIComponent(until)}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return
      return response.json()
    }).then((agenda) => {
      if (!agenda) return
      setDots((agenda.appointments ?? []).map((appointment: any) => {
        const [start, end] = rangeDates(appointment.service_period)
        return { id: appointment.id, start: start.toISOString(), end: end.toISOString(), client: appointment.client?.full_name ?? 'Cliente', professionalId: appointment.professional?.id, professionalName: appointment.professional?.display_name ?? 'Profesional', professionalColor: appointment.professional?.color ?? '#5b3df5', serviceId: appointment.service?.id, serviceName: appointment.service?.name ?? 'Servicio', status: appointment.status }
      }))
    }).catch(() => {})
  }, [revision, timezone])

  const todayKey = dateKeyInZone(new Date(), timezone)
  const nowMs = Date.now()

  const dotMap = useMemo(() => {
    const map: Record<string, { count: number; unresolved: number }> = {}
    for (const appointment of dots) {
      if (appointment.status === 'CANCELLED') continue
      const key = dateKeyInZone(appointment.start, timezone)
      if (!map[key]) map[key] = { count: 0, unresolved: 0 }
      map[key].count += 1
      if (new Date(appointment.start).getTime() < nowMs && isActiveStatus(appointment.status)) map[key].unresolved += 1
    }
    return map
  }, [dots, timezone, nowMs])

  const overdue = useMemo(() => dots.filter((appointment) => isActiveStatus(appointment.status) && new Date(appointment.start).getTime() < nowMs).sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()), [dots, nowMs])

  const weekFirst = startOfWeekDateKey(todayKey)
  const weekStats = useMemo(() => {
    const inWeek = dots.filter((appointment) => {
      const key = dateKeyInZone(appointment.start, timezone)
      return key >= weekFirst && key < addDaysToDateKey(weekFirst, 7)
    })
    const effective = (appointment: AgendaAppointment) => {
      if (!isActiveStatus(appointment.status)) return appointment.status
      const start = new Date(appointment.start).getTime()
      const end = new Date(appointment.end).getTime()
      if (nowMs >= start && nowMs < end) return 'IN_PROGRESS'
      return appointment.status
    }
    return {
      total: inWeek.filter((appointment) => appointment.status !== 'CANCELLED').length,
      confirmed: inWeek.filter((appointment) => effective(appointment) === 'CONFIRMED').length,
      pending: inWeek.filter((appointment) => effective(appointment) === 'PENDING').length,
      active: inWeek.filter((appointment) => effective(appointment) === 'IN_PROGRESS' || effective(appointment) === 'CHECKED_IN').length,
      completed: inWeek.filter((appointment) => appointment.status === 'COMPLETED').length,
      noShow: inWeek.filter((appointment) => appointment.status === 'NO_SHOW').length,
    }
  }, [dots, timezone, weekFirst, nowMs])

  const matchingProfessionals = professionals.filter((professional) => `${professional.name} ${professional.specialty}`.toLowerCase().includes(professionalQuery.toLowerCase()))
  const shownProfessionals = selected === 'all' ? matchingProfessionals : matchingProfessionals.filter((professional) => professional.id === selected)
  const visibleAppointments = appointments.filter((appointment) => appointment.status !== 'CANCELLED' && (selected === 'all' || appointment.professionalId === selected))
  const visibleHolds = holds.filter((hold) => selected === 'all' || hold.professionalId === selected)

  const hoursRange = useMemo(() => {
    let start = 8
    let end = 20
    for (const appointment of visibleAppointments) {
      const parts = zonedParts(appointment.start, timezone)
      const duration = Math.max(15, Math.round((new Date(appointment.end).getTime() - new Date(appointment.start).getTime()) / 60000))
      start = Math.min(start, parts.hour)
      end = Math.max(end, Math.ceil((parts.hour * 60 + parts.minute + duration) / 60))
    }
    start = clamp(start, 0, 23)
    end = clamp(end, start + 1, 24)
    return { start, end, hours: Array.from({ length: end - start }, (_, index) => start + index) }
  }, [visibleAppointments, timezone])

  function positionOf(appointment: AgendaAppointment) {
    const parts = zonedParts(appointment.start, timezone)
    const duration = Math.max(15, Math.round((new Date(appointment.end).getTime() - new Date(appointment.start).getTime()) / 60000))
    return { day: dateKeyInZone(appointment.start, timezone), hour: parts.hour, minute: parts.minute, duration }
  }

  function move(direction: number) {
    if (view === 'day') setAnchor(addDaysToDateKey(anchor, direction))
    else if (view === 'week') setAnchor(addDaysToDateKey(anchor, direction * 7))
    else setAnchor(addMonths(anchor, direction))
  }

  function title() {
    const date = zonedDateTimeToUtc(anchor, '12:00:00', timezone)
    if (view === 'day') return formatInZone(date, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (view === 'week') {
      const last = addDaysToDateKey(windowRange.first, 6)
      return `${formatInZone(zonedDateTimeToUtc(windowRange.first, '12:00:00', timezone), timezone, { day: 'numeric', month: 'short' })} – ${formatInZone(zonedDateTimeToUtc(last, '12:00:00', timezone), timezone, { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    const [year, month] = anchor.split('-').map(Number)
    return `${MONTHS_ES[month - 1]} ${year}`
  }

  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(windowRange.first, index))
  const monthGridStart = startOfWeekDateKey(windowRange.first)
  const monthDays = Array.from({ length: 42 }, (_, index) => addDaysToDateKey(monthGridStart, index))

  function pointerMins(column: HTMLElement, clientY: number) {
    const rect = column.getBoundingClientRect()
    return clamp(round15(hoursRange.start * 60 + ((clientY - rect.top) / CELL_H) * 60), hoursRange.start * 60, hoursRange.end * 60 - 15)
  }

  function openNew(dayKey: string) {
    setNewDate(dayKey)
    setShowNew(true)
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    const response = await fetch('/api/admin/agenda', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => ({}))
    setBusy(false)
    if (!response.ok) {
      setError(result.error ?? 'No se pudo actualizar la reserva')
      return false
    }
    setRevision((value) => value + 1)
    return true
  }

  async function applyDrop() {
    if (!dropConfirm) return
    const appointment = appointments.find((item) => item.id === dropConfirm.id)
    if (!appointment) return
    const newStart = zonedDateTimeToUtc(dropConfirm.day, `${fmtMins(dropConfirm.mins)}:00`, timezone).toISOString()
    const changedProfessional = dropConfirm.professionalId !== appointment.professionalId
    if (!dropReason.trim()) {
      setError('Escribe el motivo del cambio para confirmar')
      return
    }
    const ok = await patch({ appointmentId: appointment.id, action: 'move', newStart, professionalId: dropConfirm.professionalId, reason: dropReason.trim() })
    if (ok) {
      setDropConfirm(null)
      setDropReason('')
      flash(changedProfessional
        ? `Reserva movida a ${dropProfessional?.name ?? 'otro profesional'}. El cliente recibirá el aviso con el motivo.`
        : 'Reserva movida. El cliente recibirá el aviso con el motivo.')
    }
  }

  function appointmentTone(appointment: AgendaAppointment) {
    const closed = ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(appointment.status)
    const past = new Date(appointment.start).getTime() < nowMs
    if (!closed && past) return { border: '#dc2626', bg: '#fef2f2', tx: '#b91c1c', needsClose: true }
    if (closed) return { border: '#9ca3af', bg: '#f3f4f6', tx: '#6b7280', needsClose: false }
    return { border: appointment.professionalColor, bg: hexToRgba(appointment.professionalColor, 0.12), tx: appointment.professionalColor, needsClose: false }
  }

  const isUpcoming = (appointment: AgendaAppointment) => {
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) return false
    const diff = new Date(appointment.start).getTime() - nowMs
    return diff > 0 && diff <= 35 * 60000
  }

  function appointmentCard(appointment: AgendaAppointment, opts: { day: string; lane?: string }) {
    const pos = positionOf(appointment)
    if (pos.day !== opts.day) return null
    if (opts.lane && appointment.professionalId !== opts.lane) return null
    const tone = appointmentTone(appointment)
    const top = (pos.hour - hoursRange.start + pos.minute / 60) * CELL_H + 1
    const height = Math.max((pos.duration / 60) * CELL_H - 3, 26)
    const draggable = isActiveStatus(appointment.status)
    const upcoming = isUpcoming(appointment)
    return <button
      key={appointment.id}
      draggable={draggable}
      onDragStart={(event) => {
        const column = (event.currentTarget as HTMLElement).closest('[data-col]') as HTMLElement | null
        const offset = column ? pointerMins(column, event.clientY) - (pos.hour * 60 + pos.minute) : 0
        setDragged({ id: appointment.id, duration: pos.duration, offset })
        event.dataTransfer.setData('text/agen-appointment', appointment.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => { setDragged(null); setGhost(null) }}
      onClick={(event) => { event.stopPropagation(); setSelectedAppointment(appointment) }}
      title={`${formatTimeInZone(appointment.start, timezone)} · ${appointment.client} · ${appointment.serviceName}`}
      className={`absolute left-1 right-1 overflow-hidden rounded-md border-l-4 p-1 text-left text-[11px] leading-tight shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${upcoming ? 'animate-pulse' : ''}`}
      style={{ top, height, background: tone.bg, borderColor: tone.border, color: tone.tx, zIndex: upcoming ? 3 : 2, boxShadow: upcoming ? `0 0 0 1.5px ${hexToRgba(tone.border, 0.5)}` : undefined }}
    >
      <b className="block truncate">{formatTimeInZone(appointment.start, timezone)} · {appointment.client}</b>
      {height > 34 && <span className="block truncate opacity-80">{appointment.serviceName}</span>}
      {height > 52 && <span className="block truncate opacity-60">{appointment.professionalName} · {pos.duration} min</span>}
      {tone.needsClose && height > 34 && <span className="block font-bold">⚠ Por cerrar</span>}
    </button>
  }

  function holdCard(hold: Hold, day: string, lane?: string) {
    const pos = positionOf({ ...hold, status: 'PENDING', client: hold.client, professionalId: hold.professionalId, professionalName: '', professionalColor: '', serviceId: '', serviceName: hold.serviceName } as AgendaAppointment)
    if (pos.day !== day) return null
    if (lane && hold.professionalId !== lane) return null
    const top = (pos.hour - hoursRange.start + pos.minute / 60) * CELL_H + 1
    const height = Math.max((pos.duration / 60) * CELL_H - 3, 22)
    const minsLeft = Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - nowMs) / 60000))
    return <div key={hold.id} className="absolute left-1 right-1 overflow-hidden rounded-md border-[1.5px] border-dashed border-amber-500 p-1 text-[10px] text-amber-900" style={{ top, height, zIndex: 1, background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.15) 0 7px, transparent 7px 14px)' }} title={`Apartado por el agente · vence en ${minsLeft} min`}>
      <b className="block truncate">Apartado</b>
      {height > 26 && <span className="block truncate">{hold.client} · vence en {minsLeft} min</span>}
    </div>
  }

  function timeColumn(day: string, lane?: string) {
    const dayAppointments = visibleAppointments
    const dayHolds = visibleHolds
    const isToday = day === todayKey
    const nowParts = zonedParts(new Date(), timezone)
    const nowY = (nowParts.hour - hoursRange.start + nowParts.minute / 60) * CELL_H
    return <div
      key={`${day}-${lane ?? 'all'}`}
      data-col={day}
      className="relative flex-1 border-l border-black/5"
      style={{ height: hoursRange.hours.length * CELL_H, background: isToday ? 'rgba(91,61,245,0.03)' : undefined }}
      onClick={(event) => { if (dragged) return; openNew(day) }}
      onMouseMove={(event) => { if (dragged) return; setHover({ day, mins: pointerMins(event.currentTarget, event.clientY) }) }}
      onMouseLeave={() => setHover(null)}
      onDragOver={(event) => {
        if (!dragged) return
        event.preventDefault()
        const mins = clamp(round15(pointerMins(event.currentTarget, event.clientY) - dragged.offset), hoursRange.start * 60, hoursRange.end * 60 - 15)
        setGhost({ day, mins, professionalId: lane })
      }}
      onDrop={(event) => {
        event.preventDefault()
        const id = event.dataTransfer.getData('text/agen-appointment')
        if (!id || !dragged) return
        const mins = clamp(round15(pointerMins(event.currentTarget, event.clientY) - dragged.offset), hoursRange.start * 60, hoursRange.end * 60 - 15)
        const appointment = appointments.find((item) => item.id === id)
        if (!appointment) return
        const professionalId = lane ?? appointment.professionalId
        if (mins === positionOf(appointment).hour * 60 + positionOf(appointment).minute && professionalId === appointment.professionalId && day === positionOf(appointment).day) return
        setDropConfirm({ id, day, mins, professionalId })
        setDropReason('')
        setDragged(null)
        setGhost(null)
      }}
    >
      {hoursRange.hours.map((hour, index) => <div key={hour} className="pointer-events-none absolute left-0 right-0 border-t border-black/5" style={{ top: index * CELL_H }}/>)}
      {hoursRange.hours.map((hour, index) => <div key={`half-${hour}`} className="pointer-events-none absolute left-2 right-0 border-t border-dashed border-black/5 opacity-40" style={{ top: index * CELL_H + CELL_H / 2 }}/>)}
      {hover && hover.day === day && !dragged && <div className="pointer-events-none absolute left-0 right-0 z-[1] border-t border-dashed border-[#5b3df5]" style={{ top: ((hover.mins / 60) - hoursRange.start) * CELL_H }}><span className="absolute left-1 -top-2.5 rounded bg-[#5b3df5] px-1 font-mono text-[9px] font-bold text-white">+ {fmtMins(hover.mins)}</span></div>}
      {ghost && ghost.day === day && dragged && <div className="pointer-events-none absolute left-1 right-1 z-[6] rounded-md border-2 border-dashed border-[#5b3df5] bg-violet-50/60" style={{ top: ((ghost.mins / 60) - hoursRange.start) * CELL_H + 2, height: Math.max((dragged.duration / 60) * CELL_H - 3, 22) }}><span className="block pt-1 text-center font-mono text-[10px] font-bold text-[#5b3df5]">{fmtMins(ghost.mins)} – {fmtMins(ghost.mins + dragged.duration)}</span></div>}
      {isToday && nowParts.hour >= hoursRange.start && nowParts.hour < hoursRange.end && <div className="pointer-events-none absolute left-0 right-0 z-[3]" style={{ top: nowY }}><span className="absolute -left-1 -top-[4px] h-2 w-2 rounded-full bg-[#5b3df5]"/><div className="h-[2px] bg-[#5b3df5] opacity-70"/></div>}
      {dayAppointments.map((appointment) => appointmentCard(appointment, { day, lane }))}
      {dayHolds.map((hold) => holdCard(hold, day, lane))}
    </div>
  }

  function hourLabels() {
    return <div style={{ width: T_COL_W }}>{hoursRange.hours.map((hour) => <div key={hour} className="pr-2 text-right font-mono text-[10px] font-semibold text-[#736f83]" style={{ height: CELL_H }}>{String(hour).padStart(2, '0')}:00</div>)}</div>
  }

  const dropAppointment = dropConfirm ? appointments.find((item) => item.id === dropConfirm.id) ?? null : null
  const dropProfessional = dropConfirm ? professionals.find((professional) => professional.id === dropConfirm.professionalId) : null

  return <>
    <style>{`@keyframes agendapulse{0%,100%{box-shadow:0 0 0 1.5px rgba(91,61,245,.45)}50%{box-shadow:0 0 0 3px rgba(91,61,245,.15)}}`}</style>
    {showNew && <NewAppointmentModal initialDate={newDate ?? undefined} timezone={timezone} onClose={() => { setShowNew(false); setNewDate(null) }} onCreated={() => setRevision((value) => value + 1)} />}
    {selectedAppointment && <AppointmentDetailsModal appointment={selectedAppointment} timezone={timezone} onClose={() => setSelectedAppointment(null)} onUpdated={() => setRevision((value) => value + 1)} />}
    {noShowFor && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6">
      <h3 className="text-lg font-black">Marcar como no asistió</h3>
      <p className="mt-2 text-sm leading-6 text-[#736f83]">{noShowFor.client} · {formatInZone(noShowFor.start, timezone, { day: 'numeric', month: 'short' })} {formatTimeInZone(noShowFor.start, timezone)}. ¿Avisar al cliente para reagendar?</p>
      <label className="mt-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={noShowNotify} onChange={(event) => setNoShowNotify(event.target.checked)}/>Avisar al cliente por WhatsApp/correo</label>
      <div className="mt-4 flex gap-2">
        <button disabled={busy} onClick={async () => { const ok = await patch({ appointmentId: noShowFor.id, action: 'status', status: 'NO_SHOW', notify: noShowNotify }); if (ok) setNoShowFor(null) }} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">Marcar{noShowNotify ? ' y avisar' : ''}</button>
        <button onClick={() => setNoShowFor(null)} className="flex-1 rounded-xl border py-2.5 text-sm font-semibold">Cancelar</button>
      </div>
    </div></div>}
    {dropConfirm && dropAppointment && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4"><div className="w-full max-w-md rounded-3xl bg-white p-6">
      <h3 className="text-lg font-black">¿Mover esta reserva?</h3>
      <p className="mt-1 text-sm text-[#736f83]">{dropAppointment.client} · {dropAppointment.serviceName}</p>
      <div className="mt-4 space-y-2 rounded-xl bg-[#f6f5fa] p-3 text-sm">
        <p className="opacity-70 line-through">{positionOf(dropAppointment).day} · {formatTimeInZone(dropAppointment.start, timezone)} · {dropAppointment.professionalName}</p>
        <p className="font-bold">{dropConfirm.day} · {fmtMins(dropConfirm.mins)} · {dropProfessional?.name ?? dropAppointment.professionalName}</p>
      </div>
      <label className="mt-4 block text-sm font-semibold">Motivo del cambio *<input autoFocus value={dropReason} onChange={(event) => setDropReason(event.target.value)} maxLength={300} className="mt-2 w-full rounded-xl border-2 p-3" placeholder="Ej: la profesional tuvo una urgencia"/></label>
      <p className="mt-2 text-xs text-[#736f83]">{dropAppointment.phone ? `Se le enviará un WhatsApp a ${dropAppointment.client} con el cambio y el motivo.` : 'El cliente no tiene teléfono registrado: no recibirá aviso.'}</p>
      {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle size={18} className="shrink-0"/><span>{error}</span></p>}
      <div className="mt-4 flex gap-2">
        <button disabled={busy} onClick={() => void applyDrop()} className="flex-1 rounded-xl bg-[#5b3df5] py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Sí, mover y avisar'}</button>
        <button onClick={() => { setDropConfirm(null); setError('') }} className="flex-1 rounded-xl border py-2.5 text-sm font-semibold">Cancelar</button>
      </div>
    </div></div>}

    <PageHeader title="Agenda general" description="Agenda del negocio por profesional, con apartados del agente y pendientes por cerrar." action={<button onClick={() => openNew(anchor)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Nueva reserva</button>} />
    {error && !dropConfirm && <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm font-bold text-red-800"><AlertTriangle size={20} className="shrink-0"/><span>{error}</span></p>}
    {saved && <p role="status" className="mb-4 flex items-start gap-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><CheckCircle2 size={20} className="shrink-0"/><span>{saved}</span></p>}

    <div className="mb-4 flex flex-col justify-between gap-3 rounded-2xl border bg-white p-3 lg:flex-row lg:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <button aria-label="Anterior" onClick={() => move(-1)} className="rounded-lg border p-2"><ChevronLeft size={18} /></button>
        <button onClick={() => setAnchor(todayKey)} className="rounded-lg border px-4 py-2 text-sm font-bold">Hoy</button>
        <button aria-label="Siguiente" onClick={() => move(1)} className="rounded-lg border p-2"><ChevronRight size={18} /></button>
        <b className="ml-1 capitalize">{title()}</b>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-[#5b3df5]">{visibleAppointments.length} reservas</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl bg-[#f1eff7] p-1">{(['day', 'week', 'month'] as View[]).map((option) => <button key={option} onClick={() => setView(option)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${view === option ? 'bg-[#5b3df5] text-white' : 'text-[#736f83]'}`}>{option === 'day' ? 'Día' : option === 'week' ? 'Semana' : 'Mes'}</button>)}</div>
        {view === 'day' && professionals.length > 1 && <button onClick={() => setPorProfesional((value) => !value)} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${porProfesional ? 'border-[#5b3df5] bg-violet-50 text-[#5b3df5]' : ''}`}>Por profesional</button>}
        <input value={professionalQuery} onChange={(event) => setProfessionalQuery(event.target.value)} placeholder="Buscar profesional" className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm" />
        <select value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm"><option value="all">Todo el equipo</option>{professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name} · {professional.specialty}</option>)}</select>
      </div>
    </div>

    <div className="flex flex-col gap-4 xl:flex-row">
      <aside className="w-full shrink-0 space-y-4 xl:w-60">
        <MiniCalendar todayKey={todayKey} anchor={anchor} dotMap={dotMap} onPick={(day) => { setAnchor(day); setView('day') }} />
        <section className="rounded-2xl border bg-white p-4">
          <h3 className="text-xs font-black uppercase tracking-wide text-[#736f83]">Esta semana</h3>
          <div className="mt-2 space-y-1 text-sm">{[
            ['Total', weekStats.total, '#111827'],
            ['Confirmadas', weekStats.confirmed, '#0f766e'],
            ['Pendientes', weekStats.pending, '#5b3df5'],
            ['En atención', weekStats.active, '#7e22ce'],
            ['Completadas', weekStats.completed, '#15803d'],
            ['No asistió', weekStats.noShow, '#b45309'],
          ].map(([label, value, color]) => <div key={label as string} className="flex justify-between"><span className="text-[#736f83]">{label}</span><b className="font-mono" style={{ color: color as string }}>{value}</b></div>)}</div>
        </section>
        {overdue.length > 0 && <section className="rounded-2xl border border-red-200 bg-white">
          <div className="flex items-center justify-between rounded-t-2xl bg-red-50 px-4 py-2.5"><h3 className="text-xs font-black uppercase tracking-wide text-red-700">⚠ Por cerrar</h3><span className="rounded-full bg-red-600 px-2 py-0.5 font-mono text-xs font-bold text-white">{overdue.length}</span></div>
          <div className="max-h-72 space-y-2 overflow-y-auto p-3">{overdue.slice(0, 30).map((appointment) => <div key={appointment.id} className="rounded-xl border border-red-100 p-2.5">
            <b className="block truncate text-sm">{appointment.client}</b>
            <p className="font-mono text-[11px] text-[#736f83]">{formatInZone(appointment.start, timezone, { day: '2-digit', month: '2-digit' })} {formatTimeInZone(appointment.start, timezone)} · {appointment.professionalName}</p>
            <div className="mt-2 flex gap-1.5">
              <button title="Completada" disabled={busy} onClick={() => void patch({ appointmentId: appointment.id, action: 'status', status: 'COMPLETED' })} className="grid h-8 flex-1 place-items-center rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"><Check size={15} /></button>
              <button title="No asistió" disabled={busy} onClick={() => { setNoShowFor(appointment); setNoShowNotify(true) }} className="grid h-8 flex-1 place-items-center rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"><X size={15} /></button>
              <button title="Abrir ficha" onClick={() => setSelectedAppointment(appointment)} className="grid h-8 flex-1 place-items-center rounded-lg bg-[#f6f5fa] text-[#5b3df5]"><CalendarDays size={15} /></button>
            </div>
          </div>)}</div>
        </section>}
        <section className="rounded-2xl border bg-white p-4">
          <h3 className="text-xs font-black uppercase tracking-wide text-[#736f83]">Equipo</h3>
          <div className="mt-2 space-y-1.5">{professionals.slice(0, 12).map((professional) => <div key={professional.id} className="flex items-center gap-2 text-sm"><span className="h-3 w-3 rounded" style={{ background: professional.color }} /><span className="truncate">{professional.name}</span></div>)}{professionals.length === 0 && <p className="text-xs text-[#736f83]">Sin profesionales registrados</p>}</div>
        </section>
      </aside>

      <div className="min-w-0 flex-1" ref={gridRef}>
        {loading && <p className="rounded-2xl border bg-white p-8 text-center text-sm text-[#736f83]">Cargando agenda…</p>}

        {!loading && view === 'day' && <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <div className="flex border-b bg-[#faf9fc]">
            <div style={{ width: T_COL_W }} />
            {porProfesional ? shownProfessionals.map((professional) => {
              const count = visibleAppointments.filter((appointment) => dateKeyInZone(appointment.start, timezone) === anchor && appointment.professionalId === professional.id).length
              return <div key={professional.id} className="min-w-24 flex-1 border-l border-black/5 p-2 text-center"><span className="mx-auto mb-1 block h-1.5 w-8 rounded-full" style={{ background: professional.color }} /><b className="block truncate text-xs">{professional.name}</b><small className="text-[10px] text-[#736f83]">{count === 0 ? 'libre todo el día' : `${count} reserva(s)`}</small></div>
            }) : <div className="flex-1 p-2 text-center"><b className="text-xs capitalize">{formatInZone(zonedDateTimeToUtc(anchor, '12:00:00', timezone), timezone, { weekday: 'long', day: 'numeric', month: 'long' })}</b></div>}
          </div>
          <div className="overflow-x-auto"><div className="flex" style={{ minWidth: porProfesional ? Math.max(shownProfessionals.length * 140 + T_COL_W, 700) : 640, maxHeight: 580, overflowY: 'auto' }}>
            {hourLabels()}
            {porProfesional ? shownProfessionals.map((professional) => timeColumn(anchor, professional.id)) : timeColumn(anchor)}
          </div></div>
          {shownProfessionals.length === 0 && <p className="p-8 text-center text-sm text-[#736f83]">Agrega profesionales para comenzar.</p>}
        </div>}

        {!loading && view === 'week' && <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
          <div className="flex border-b bg-[#faf9fc]">
            <div style={{ width: T_COL_W }} />
            {weekDays.map((day) => {
              const count = visibleAppointments.filter((appointment) => dateKeyInZone(appointment.start, timezone) === day).length
              return <button key={day} onClick={() => { setAnchor(day); setView('day') }} className={`flex-1 border-l border-black/5 p-2 text-center hover:bg-violet-50 ${day === todayKey ? 'bg-violet-50' : ''}`}>
                <span className={`block text-[10px] font-bold uppercase ${day === todayKey ? 'text-[#5b3df5]' : 'text-[#736f83]'}`}>{WEEK_HEADS[weekDays.indexOf(day)]}</span>
                <span className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-black ${day === todayKey ? 'bg-[#5b3df5] text-white' : ''}`}>{Number(day.slice(-2))}</span>
                {count > 0 && <span className="mt-0.5 inline-block rounded-full border px-1.5 text-[10px] font-bold text-[#736f83]">{count}</span>}
              </button>
            })}
          </div>
          <div className="flex" style={{ maxHeight: 560, overflowY: 'auto' }}>
            {hourLabels()}
            {weekDays.map((day) => timeColumn(day))}
          </div>
        </div>}

        {!loading && view === 'month' && <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm"><div className="min-w-[820px]">
          <div className="grid grid-cols-7 border-b bg-[#f7f6fa] text-center text-xs font-bold uppercase text-[#736f83]">{WEEK_HEADS.map((day) => <div key={day} className="p-3">{day}</div>)}</div>
          <div className="grid grid-cols-7">{monthDays.map((day) => {
            const dayAppointments = visibleAppointments.filter((appointment) => dateKeyInZone(appointment.start, timezone) === day).sort((a, b) => a.start.localeCompare(b.start))
            const inMonth = day.slice(0, 7) === windowRange.first.slice(0, 7)
            return <button key={day} onClick={() => { setAnchor(day); setView('day') }} className={`min-h-28 border-b border-r p-2 text-left align-top hover:bg-violet-50/40 ${inMonth ? '' : 'bg-[#fafafa] opacity-55'}`}>
              <span className={`mb-1 grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${day === todayKey ? 'bg-[#5b3df5] text-white' : ''}`}>{Number(day.slice(-2))}</span>
              {dayAppointments.slice(0, 3).map((appointment) => {
                const tone = appointmentTone(appointment)
                return <span key={appointment.id} className="mb-1 block truncate rounded border-l-2 px-1 py-0.5 text-[10px] font-semibold" style={{ background: tone.bg, color: tone.tx, borderColor: tone.border }}>{formatTimeInZone(appointment.start, timezone)} {appointment.client}</span>
              })}
              {dayAppointments.length > 3 && <span className="text-[10px] font-bold text-[#5b3df5]">+{dayAppointments.length - 3} más</span>}
            </button>
          })}</div>
        </div></div>}
      </div>
    </div>
  </>
}

function MiniCalendar({ todayKey, anchor, dotMap, onPick }: { todayKey: string; anchor: string; dotMap: Record<string, { count: number; unresolved: number }>; onPick: (day: string) => void }) {
  const [year, month] = anchor.split('-').map(Number)
  const [calYear, setCalYear] = useState(year)
  const [calMonth, setCalMonth] = useState(month)
  useEffect(() => { setCalYear(year); setCalMonth(month) }, [year, month])
  const firstDow = (new Date(Date.UTC(calYear, calMonth - 1, 1)).getDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate()
  const cells: Array<string | null> = []
  for (let index = 0; index < firstDow; index++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(`${calYear}-${String(calMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return <section className="rounded-2xl border bg-white p-4">
    <div className="flex items-center justify-between">
      <button aria-label="Mes anterior" onClick={() => { if (calMonth === 1) { setCalMonth(12); setCalYear((value) => value - 1) } else setCalMonth((value) => value - 1) }} className="rounded border px-2 py-0.5 text-sm">‹</button>
      <b className="text-xs font-black uppercase">{MONTHS_ES[calMonth - 1].slice(0, 3)} {calYear}</b>
      <button aria-label="Mes siguiente" onClick={() => { if (calMonth === 12) { setCalMonth(1); setCalYear((value) => value + 1) } else setCalMonth((value) => value + 1) }} className="rounded border px-2 py-0.5 text-sm">›</button>
    </div>
    <div className="mt-2 grid grid-cols-7 text-center text-[9px] font-bold text-[#736f83]">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((head, index) => <span key={index}>{head}</span>)}</div>
    <div className="mt-1 grid grid-cols-7 gap-0.5">{cells.map((day, index) => {
      if (!day) return <span key={index} className="h-7" />
      const info = dotMap[day]
      const isToday = day === todayKey
      const isPast = day < todayKey
      return <button key={index} onClick={() => onPick(day)} title={info ? `${info.count} reserva(s)${info.unresolved ? ` · ${info.unresolved} sin cerrar` : ''}` : ''} className={`flex h-7 flex-col items-center justify-center rounded text-[11px] font-semibold ${isToday ? 'bg-[#5b3df5] text-white' : isPast ? 'text-[#9ca3af]' : 'text-[#374151] hover:bg-violet-50'}`}>
        {Number(day.slice(-2))}
        <span className="flex h-1.5 gap-0.5">
          {info && info.unresolved > 0 && <i className="h-1.5 w-1.5 rounded-full bg-red-600" />}
          {info && info.unresolved === 0 && <i className={`h-1.5 w-1.5 rounded-full ${isToday ? 'bg-white' : isPast ? 'bg-gray-400' : 'bg-emerald-500'}`} />}
        </span>
      </button>
    })}</div>
    <p className="mt-2 text-[10px] text-[#736f83]"><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />próximas <i className="ml-2 mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-600" />sin cerrar</p>
  </section>
}
