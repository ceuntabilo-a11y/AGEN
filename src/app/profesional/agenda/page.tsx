'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { NewBlockModal } from '@/components/NewBlockModal'
import { ProfessionalCalendarSync } from '@/components/ProfessionalCalendarSync'
import { AppointmentDetailsModal, type AgendaAppointment } from '@/components/AppointmentDetailsModal'
import { AgendaCalendario, LeyendaAgenda, type BloqueoAgenda, type CitaAgenda } from '@/components/AgendaCalendario'
import { ListPlaceholder } from '@/components/ListPlaceholder'
import { addDaysToDateKey, dateKeyInZone, formatInZone, formatTimeInZone, zonedDateTimeToUtc } from '@/lib/timezone'
import { aHoraTexto, semanaDe, tramoDelDia, weekdayDeDateKey } from '@/lib/agenda-calendario'
import type { BusinessDay } from '@/lib/business-hours'

/**
 * "Mi agenda" del profesional.
 *
 * Antes era una lista de los próximos siete días: no se veía a qué hora caía cada cosa, ni
 * cuánto duraba, ni qué ratos quedaban libres — es decir, no era una agenda. Ahora es un
 * calendario de verdad con vista Día y Semana, eje de horas, citas a escala, descansos,
 * bloqueos y huecos libres, y debajo la lista del día con las acciones de siempre (confirmar,
 * llegó, iniciar, completar, no asistió, reagendar o cancelar).
 *
 * La sincronización con Google/iPhone baja a función secundaria, plegada: es útil, pero no es
 * lo que se viene a hacer acá.
 */

type Reserva = {
  id: string
  status: string
  service_period: string
  notes?: string | null
  client_confirmed_at?: string | null
  client?: { id?: string; full_name?: string; phone?: string } | null
  service?: { id?: string; name?: string } | null
}
type Bloqueo = { id: string; period: string; reason?: string | null }

const rango = (value: string) => value.replace(/[[\]()"]/g, '').split(',')

export default function ProfessionalAgenda() {
  const [vista, setVista] = useState<'dia' | 'semana'>('semana')
  const [timezone, setTimezone] = useState('America/Santiago')
  const [dateKey, setDateKey] = useState<string | null>(null)
  const [appointments, setAppointments] = useState<Reserva[]>([])
  const [blocks, setBlocks] = useState<Bloqueo[]>([])
  const [availability, setAvailability] = useState<Array<{ weekday: number; startsAt: string; endsAt: string }>>([])
  const [businessHours, setBusinessHours] = useState<BusinessDay[] | null>(null)
  const [professional, setProfessional] = useState<{ id?: string; display_name?: string; color?: string } | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bloqueoPrevio, setBloqueoPrevio] = useState<{ desde?: string; hasta?: string } | null>(null)
  const [selected, setSelected] = useState<AgendaAppointment | null>(null)
  const [aviso, setAviso] = useState('')

  // El día de hoy se resuelve en la zona del NEGOCIO, no en la del navegador, y solo después
  // del primer render: en el servidor no existe "hoy" del usuario.
  useEffect(() => { setDateKey((actual) => actual ?? dateKeyInZone(new Date(), timezone)) }, [timezone])

  // En un teléfono la semana entera obliga a desplazarse en horizontal para leer cualquier
  // cosa. Se abre en Día, que es además lo que se mira de pie en el local. Solo al entrar:
  // si luego se cambia a Semana, se respeta.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) setVista('dia')
  }, [])

  const dias = useMemo(() => (dateKey ? (vista === 'dia' ? [dateKey] : semanaDe(dateKey)) : []), [dateKey, vista])

  const ventana = useMemo(() => {
    if (!dias.length) return null
    return {
      from: zonedDateTimeToUtc(dias[0], '00:00:00', timezone).toISOString(),
      until: zonedDateTimeToUtc(addDaysToDateKey(dias[dias.length - 1], 1), '00:00:00', timezone).toISOString(),
    }
  }, [dias, timezone])

  const load = useCallback(() => {
    if (!ventana) return Promise.resolve()
    setLoading(true)
    return fetch(`/api/professional/agenda?from=${ventana.from}&until=${ventana.until}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => {
        setAppointments(d.appointments ?? [])
        setBlocks(d.blocks ?? [])
        setAvailability(d.availability ?? [])
        setBusinessHours(d.businessHours ?? null)
        setProfessional(d.professional ?? null)
        if (d.timezone) setTimezone(d.timezone)
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [ventana])

  useEffect(() => { load() }, [load])

  const citas: CitaAgenda[] = useMemo(() => appointments.map((a) => {
    const [inicio, fin] = rango(a.service_period)
    return {
      id: a.id,
      inicio,
      fin,
      titulo: a.client?.full_name ?? 'Cliente',
      subtitulo: a.service?.name ?? null,
      estado: a.status,
      confirmada: Boolean(a.client_confirmed_at),
    }
  }), [appointments])

  const bloqueos: BloqueoAgenda[] = useMemo(() => blocks.map((b) => {
    const [inicio, fin] = rango(b.period)
    return { id: b.id, inicio, fin, motivo: b.reason ?? null }
  }), [blocks])

  /** Las citas del día que se está mirando (o del primer día con algo, en vista semana). */
  const delDia = useMemo(() => {
    if (!dateKey) return []
    return appointments
      .map((a) => {
        const [inicio, fin] = rango(a.service_period)
        return { reserva: a, tramo: tramoDelDia(inicio, fin, dateKey, timezone) }
      })
      .filter((item) => item.tramo !== null)
      .sort((a, b) => (a.tramo!.desde - b.tramo!.desde))
  }, [appointments, dateKey, timezone])

  function mover(pasos: number) {
    setDateKey((actual) => (actual ? addDaysToDateKey(actual, pasos * (vista === 'dia' ? 1 : 7)) : actual))
  }

  function abrirCita(id: string) {
    const a = appointments.find((item) => item.id === id)
    if (!a) return
    const [inicio, fin] = rango(a.service_period)
    setSelected({
      id: a.id,
      start: new Date(inicio).toISOString(),
      end: new Date(fin).toISOString(),
      client: a.client?.full_name ?? 'Cliente',
      phone: a.client?.phone,
      professionalId: professional?.id ?? '',
      professionalName: professional?.display_name ?? '',
      professionalColor: professional?.color ?? '#5b3df5',
      serviceId: a.service?.id ?? '',
      serviceName: a.service?.name ?? 'Servicio',
      status: a.status,
      notes: a.notes,
      confirmedByClient: Boolean(a.client_confirmed_at),
    })
  }

  async function cambiarEstado(id: string, next: string) {
    let notify = false
    if (next === 'NO_SHOW') notify = window.confirm('Aceptar: marcar y avisar al cliente para reagendar. Cancelar: solo marcar como no asistió.')
    const response = await fetch('/api/professional/agenda', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appointmentId: id, status: next, notify }),
    })
    if (response.ok) { setAviso('Estado actualizado.'); load() } else {
      const data = await response.json().catch(() => ({}))
      setAviso(data.error ?? 'No se pudo cambiar el estado.')
    }
  }

  async function quitarBloqueo(id: string) {
    if (!window.confirm('¿Quitar este bloqueo? El horario vuelve a quedar disponible para reservas.')) return
    const response = await fetch(`/api/professional/blocks?id=${id}`, { method: 'DELETE' })
    if (response.ok) { setAviso('Bloqueo quitado.'); load() }
  }

  const titulo = dateKey
    ? vista === 'dia'
      ? formatInZone(`${dateKey}T12:00:00Z`, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' })
      : `${formatInZone(`${dias[0]}T12:00:00Z`, 'UTC', { day: 'numeric', month: 'short' })} – ${formatInZone(`${dias[6]}T12:00:00Z`, 'UTC', { day: 'numeric', month: 'short' })}`
    : ''

  return (
    <>
      {bloqueoPrevio && (
        <NewBlockModal
          timeZone={timezone}
          desdePorDefecto={bloqueoPrevio.desde}
          hastaPorDefecto={bloqueoPrevio.hasta}
          onClose={() => setBloqueoPrevio(null)}
          onCreated={() => { setAviso('Horario bloqueado.'); load() }}
        />
      )}
      {selected && (
        <AppointmentDetailsModal
          appointment={selected}
          timezone={timezone}
          endpoint="/api/professional/agenda"
          onClose={() => setSelected(null)}
          onUpdated={() => { setAviso('Reserva actualizada.'); load() }}
        />
      )}

      <PageHeader
        title="Mi agenda"
        description="Tus horas, descansos y bloqueos, a escala real."
        action={(
          <button
            onClick={() => setBloqueoPrevio({})}
            className="rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"
          >
            Bloquear horario
          </button>
        )}
      />

      {aviso && (
        <p role="status" className="mb-4 rounded-xl border-l-4 border-emerald-500 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
          {aviso}
        </p>
      )}
      {error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">No se pudo cargar tu agenda. Reintenta en unos segundos.</p>}

      {/* Barra de navegación del calendario */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button aria-label="Anterior" onClick={() => mover(-1)} className="rounded-lg border p-2 hover:bg-slate-50"><ChevronLeft size={18} /></button>
          <button
            onClick={() => setDateKey(dateKeyInZone(new Date(), timezone))}
            className="rounded-lg border px-3 py-2 text-sm font-bold hover:bg-slate-50"
          >
            Hoy
          </button>
          <button aria-label="Siguiente" onClick={() => mover(1)} className="rounded-lg border p-2 hover:bg-slate-50"><ChevronRight size={18} /></button>
          <span className="ml-2 text-sm font-extrabold capitalize text-[#2c2545]">{titulo}</span>
        </div>
        <div className="flex rounded-lg border p-0.5">
          {(['dia', 'semana'] as const).map((opcion) => (
            <button
              key={opcion}
              onClick={() => setVista(opcion)}
              aria-pressed={vista === opcion}
              className={`rounded-md px-3 py-1.5 text-sm font-bold ${vista === opcion ? 'bg-[#5b3df5] text-white' : 'text-[#736f83]'}`}
            >
              {opcion === 'dia' ? 'Día' : 'Semana'}
            </button>
          ))}
        </div>
      </div>

      {dateKey && (
        <AgendaCalendario
          vista={vista}
          dateKey={dateKey}
          dias={dias}
          timeZone={timezone}
          citas={citas}
          bloqueos={bloqueos}
          disponibilidad={availability}
          horarioNegocio={businessHours}
          onAbrirCita={abrirCita}
          onHuecoLibre={(dia, desde, hasta) => setBloqueoPrevio({ desde: `${dia}T${desde}`, hasta: `${dia}T${hasta}` })}
        />
      )}
      <LeyendaAgenda />

      {/* Detalle del día: las acciones de siempre, ahora debajo del calendario */}
      <div className="mt-6 rounded-2xl border bg-white p-5">
        <h2 className="font-extrabold capitalize">
          {dateKey ? formatInZone(`${dateKey}T12:00:00Z`, 'UTC', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Día'}
        </h2>
        <p className="mt-1 text-sm text-[#736f83]">
          {delDia.length === 1 ? '1 hora agendada' : `${delDia.length} horas agendadas`}
          {dateKey && availability.length > 0 && !availability.some((t) => t.weekday === weekdayDeDateKey(dateKey)) && ' · no atiendes este día'}
        </p>

        <div className="mt-4">
          {delDia.map(({ reserva: a, tramo }) => (
            <div key={a.id} className="mb-3 rounded-xl border-l-4 border-[#7c5cff] bg-violet-50 p-4">
              <div className="grid gap-3 sm:grid-cols-[130px_1fr_auto] sm:items-center">
                <b className="tabular-nums">{aHoraTexto(tramo!.desde)} – {aHoraTexto(tramo!.hasta)}</b>
                <div>
                  <b>{a.client?.full_name ?? 'Cliente'}</b>
                  <p className="text-sm text-[#736f83]">{a.service?.name}</p>
                </div>
                <span className="w-fit rounded-full bg-white px-3 py-1 text-xs">
                  {a.client_confirmed_at ? 'Confirmada por el cliente' : a.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {a.status === 'PENDING' && <button onClick={() => cambiarEstado(a.id, 'CONFIRMED')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold">Confirmar</button>}
                {['PENDING', 'CONFIRMED'].includes(a.status) && <button onClick={() => cambiarEstado(a.id, 'CHECKED_IN')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold">Llegó</button>}
                {a.status === 'CHECKED_IN' && <button onClick={() => cambiarEstado(a.id, 'IN_PROGRESS')} className="rounded-lg bg-[#5b3df5] px-3 py-2 text-xs font-bold text-white">Iniciar</button>}
                {a.status === 'IN_PROGRESS' && <button onClick={() => cambiarEstado(a.id, 'COMPLETED')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Completar</button>}
                {['PENDING', 'CONFIRMED'].includes(a.status) && <button onClick={() => cambiarEstado(a.id, 'NO_SHOW')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-600">No asistió</button>}
                {['PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(a.status) && <button onClick={() => abrirCita(a.id)} className="rounded-lg border border-[#5b3df5] px-3 py-2 text-xs font-bold text-[#5b3df5]">Reagendar o cancelar</button>}
              </div>
            </div>
          ))}
          {delDia.length === 0 && (
            <ListPlaceholder loading={loading} error={error} className="py-8 text-center text-sm text-[#736f83]">
              No tienes horas agendadas este día.
            </ListPlaceholder>
          )}
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="mt-6 rounded-2xl border bg-white p-5">
          <h2 className="font-extrabold">Bloqueos de tu horario</h2>
          <p className="mt-1 text-sm text-[#736f83]">Ratos en que no se te pueden reservar clientes.</p>
          <div className="mt-4 space-y-2">
            {blocks.map((b) => {
              const [inicio, fin] = rango(b.period)
              return (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/5 p-3">
                  <div>
                    <b className="text-sm">
                      {formatInZone(inicio, timezone, { weekday: 'short', day: 'numeric', month: 'short' })} · {formatTimeInZone(inicio, timezone)} a {formatTimeInZone(fin, timezone)}
                    </b>
                    <p className="text-xs text-[#736f83]">{b.reason ?? 'Sin motivo'}</p>
                  </div>
                  <button onClick={() => quitarBloqueo(b.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700">Quitar</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Función secundaria: llevar la agenda al calendario del teléfono o del reloj. */}
      <details className="mt-6 rounded-2xl border bg-white p-5">
        <summary className="cursor-pointer text-sm font-extrabold text-[#2c2545]">
          <CalendarDays size={16} className="mr-2 inline" />
          Ver también en Google Calendar, iPhone o el reloj
        </summary>
        <div className="mt-4">
          <ProfessionalCalendarSync />
        </div>
      </details>
    </>
  )
}
