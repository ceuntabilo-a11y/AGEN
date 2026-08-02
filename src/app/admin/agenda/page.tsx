'use client'

import { PageHeader } from '@/components/PageHeader'
import { NewAppointmentModal } from '@/components/NewAppointmentModal'
import { AgendaAppointment, AppointmentDetailsModal } from '@/components/AppointmentDetailsModal'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  addDaysToDateKey,
  dateKeyInZone,
  formatInZone,
  formatTimeInZone,
  startOfMonthDateKey,
  startOfWeekDateKey,
  zonedDateTimeToUtc,
} from '@/lib/timezone'

type Professional = { id: string; name: string; specialty: string; color: string; initials: string }
type View = 'day' | 'week' | 'month'
type Catalog = {
  business: { timezone: string }
  specialties: Array<{ id: string; name: string }>
  professionals: Array<any>
}

const hours = Array.from({ length: 13 }, (_, index) => `${String(index + 8).padStart(2, '0')}:00`)

function rangeDates(range: string) {
  const parts = range.replace(/[\[\]()"]/g, '').split(',')
  return [new Date(parts[0]), new Date(parts[1])] as const
}

function addMonths(dateKey: string, months: number) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10)
}

function cardTone(appointment: AgendaAppointment) {
  const closed = ['COMPLETED','NO_SHOW','CANCELLED'].includes(appointment.status)
  const past = new Date(appointment.end).getTime() < Date.now()
  if (closed && past) return { background: '#d7d5dd', color: '#4f4b5a' }
  if (past && !closed) return { background: '#b42318', color: '#fff' }
  return { background: appointment.professionalColor, color: '#fff' }
}

export default function AgendaPage() {
  const [selected, setSelected] = useState('all')
  const [view, setView] = useState<View>('day')
  const [timezone, setTimezone] = useState('America/Santiago')
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<AgendaAppointment | null>(null)
  const [revision, setRevision] = useState(0)
  const [professionals, setProfessionals] = useState<Professional[]>([])
  const [appointments, setAppointments] = useState<AgendaAppointment[]>([])

  const window = useMemo(() => {
    if (view === 'day') return { first: anchor, until: addDaysToDateKey(anchor, 1) }
    if (view === 'week') {
      const first = startOfWeekDateKey(anchor)
      return { first, until: addDaysToDateKey(first, 7) }
    }
    const first = startOfMonthDateKey(anchor)
    return { first, until: addMonths(first, 1) }
  }, [anchor, view])

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
        color: professional.color,
        initials: professional.display_name.split(' ').map((value: string) => value[0]).slice(0,2).join(''),
      })))
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'No se pudo cargar la agenda'))
  }, [])

  useEffect(() => {
    const from = zonedDateTimeToUtc(window.first, '00:00:00', timezone).toISOString()
    const until = zonedDateTimeToUtc(window.until, '00:00:00', timezone).toISOString()
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
        }
      }))
      setError('')
    }).catch((caught) => setError(caught instanceof Error ? caught.message : 'No se pudo cargar la agenda')).finally(() => setLoading(false))
  }, [revision, timezone, window.first, window.until])

  const shownProfessionals = selected === 'all' ? professionals : professionals.filter((professional) => professional.id === selected)
  const shownAppointments = selected === 'all' ? appointments : appointments.filter((appointment) => appointment.professionalId === selected)

  function move(direction: number) {
    if (view === 'day') setAnchor(addDaysToDateKey(anchor, direction))
    else if (view === 'week') setAnchor(addDaysToDateKey(anchor, direction * 7))
    else setAnchor(addMonths(anchor, direction))
  }

  function title() {
    const date = zonedDateTimeToUtc(anchor, '12:00:00', timezone)
    if (view === 'day') return formatInZone(date, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (view === 'week') {
      const last = addDaysToDateKey(window.first, 6)
      return `${formatInZone(zonedDateTimeToUtc(window.first,'12:00:00',timezone),timezone,{day:'numeric',month:'short'})} – ${formatInZone(zonedDateTimeToUtc(last,'12:00:00',timezone),timezone,{day:'numeric',month:'short',year:'numeric'})}`
    }
    return formatInZone(date, timezone, { month: 'long', year: 'numeric' })
  }

  const weekDays = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(window.first, index))
  const monthGridStart = startOfWeekDateKey(window.first)
  const monthDays = Array.from({ length: 42 }, (_, index) => addDaysToDateKey(monthGridStart, index))
  const todayKey = dateKeyInZone(new Date(), timezone)

  function appointmentCard(appointment: AgendaAppointment, compact = false) {
    const tone = cardTone(appointment)
    return <button key={appointment.id} onClick={() => setSelectedAppointment(appointment)} className={`w-full rounded-lg p-2 text-left text-xs shadow-sm ${compact ? 'mb-1' : ''}`} style={tone}>
      <b className="block truncate">{formatTimeInZone(appointment.start, timezone)} · {appointment.client}</b>
      {!compact && <span className="block truncate opacity-85">{appointment.serviceName}</span>}
    </button>
  }

  return <>
    {showNew && <NewAppointmentModal timezone={timezone} onClose={() => setShowNew(false)} onCreated={() => setRevision((value) => value + 1)}/>}
    {selectedAppointment && <AppointmentDetailsModal appointment={selectedAppointment} timezone={timezone} onClose={() => setSelectedAppointment(null)} onUpdated={() => setRevision((value) => value + 1)}/>}
    <PageHeader title="Agenda general" description="Todas las agendas separadas por profesional, especialidad y color." action={<button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Nueva reserva</button>}/>
    {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    <div className="mb-4 flex flex-col justify-between gap-3 rounded-2xl border bg-white p-3 lg:flex-row lg:items-center">
      <div className="flex flex-wrap items-center gap-2"><button aria-label="Anterior" onClick={() => move(-1)} className="rounded-lg border p-2"><ChevronLeft size={18}/></button><button onClick={() => setAnchor(todayKey)} className="rounded-lg border px-4 py-2 text-sm font-bold">Hoy</button><button aria-label="Siguiente" onClick={() => move(1)} className="rounded-lg border p-2"><ChevronRight size={18}/></button><b className="ml-1 capitalize">{title()}</b></div>
      <div className="flex flex-wrap gap-2"><div className="flex rounded-xl bg-[#f1eff7] p-1">{(['day','week','month'] as View[]).map((option) => <button key={option} onClick={() => setView(option)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${view === option ? 'bg-white shadow-sm' : 'text-[#736f83]'}`}>{option === 'day' ? 'Día' : option === 'week' ? 'Semana' : 'Mes'}</button>)}</div><select value={selected} onChange={(event) => setSelected(event.target.value)} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm"><option value="all">Todo el equipo</option>{professionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.name} · {professional.specialty}</option>)}</select></div>
    </div>

    {loading && <p className="rounded-2xl border bg-white p-8 text-center text-sm text-[#736f83]">Cargando agenda…</p>}

    {!loading && view === 'day' && <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white shadow-sm"><div className="min-w-[850px]" style={{ display: 'grid', gridTemplateColumns: `72px repeat(${Math.max(shownProfessionals.length,1)}, minmax(150px, 1fr))` }}><div className="border-b border-r p-3"/>{shownProfessionals.map((professional) => <div key={professional.id} className="border-b border-r p-3 text-center"><span className="mx-auto mb-1 block h-2 w-10 rounded-full" style={{ background: professional.color }}/><b className="block text-sm">{professional.name}</b><small className="text-[#736f83]">{professional.specialty}</small></div>)}{hours.map((hour) => <div key={hour} className="contents"><div className="min-h-20 border-b border-r p-3 text-xs font-semibold text-[#736f83]">{hour}</div>{shownProfessionals.map((professional) => <div key={`${hour}-${professional.id}`} className="min-h-20 space-y-1 border-b border-r p-1">{shownAppointments.filter((appointment) => dateKeyInZone(appointment.start,timezone) === anchor && formatTimeInZone(appointment.start,timezone).slice(0,2) === hour.slice(0,2) && appointment.professionalId === professional.id).map((appointment) => appointmentCard(appointment))}</div>)}</div>)}</div>{shownProfessionals.length === 0 && <p className="p-8 text-center text-sm text-[#736f83]">Agrega profesionales y configura sus horarios para comenzar.</p>}</div>}

    {!loading && view === 'week' && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">{weekDays.map((day) => <section key={day} className={`min-h-40 rounded-2xl border bg-white p-3 ${day === todayKey ? 'ring-2 ring-[#5b3df5]/25' : ''}`}><button onClick={() => { setAnchor(day); setView('day') }} className="mb-3 w-full text-left"><b className="block capitalize">{formatInZone(zonedDateTimeToUtc(day,'12:00:00',timezone),timezone,{weekday:'long'})}</b><span className="text-xs text-[#736f83]">{formatInZone(zonedDateTimeToUtc(day,'12:00:00',timezone),timezone,{day:'numeric',month:'short'})}</span></button><div className="space-y-2">{shownAppointments.filter((appointment) => dateKeyInZone(appointment.start,timezone) === day).map((appointment) => appointmentCard(appointment))}</div></section>)}</div>}

    {!loading && view === 'month' && <div className="overflow-x-auto rounded-2xl border bg-white"><div className="min-w-[820px]"><div className="grid grid-cols-7 border-b bg-[#f7f6fa] text-center text-xs font-bold uppercase text-[#736f83]">{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((day) => <div key={day} className="p-3">{day}</div>)}</div><div className="grid grid-cols-7">{monthDays.map((day) => {const dayAppointments=shownAppointments.filter((appointment) => dateKeyInZone(appointment.start,timezone) === day);return <div key={day} className={`min-h-32 border-b border-r p-2 ${day.slice(0,7) !== window.first.slice(0,7) ? 'bg-[#fafafa] opacity-55' : ''}`}><button onClick={() => { setAnchor(day); setView('day') }} className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${day === todayKey ? 'bg-[#5b3df5] text-white' : ''}`}>{Number(day.slice(-2))}</button>{dayAppointments.slice(0,3).map((appointment) => appointmentCard(appointment,true))}{dayAppointments.length > 3 && <button onClick={() => { setAnchor(day); setView('day') }} className="text-xs font-bold text-[#5b3df5]">+{dayAppointments.length-3} más</button>}</div>})}</div></div></div>}
  </>
}
