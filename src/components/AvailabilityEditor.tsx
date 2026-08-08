'use client'

import { AlertTriangle, CheckCircle2, Lock, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { WEEKDAY_PLURAL, type BusinessDay } from '@/lib/business-hours'

type Slot = { startsAt: string; endsAt: string }
type Week = Record<number, Slot[]>

const DAYS: Array<[number, string]> = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [7, 'Domingo']]
const EMPTY: Week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }

export function AvailabilityEditor({ endpoint, professionalId, onSaved }: { endpoint: string; professionalId?: string; onSaved?: () => void }) {
  const [week, setWeek] = useState<Week>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [businessHours, setBusinessHours] = useState<BusinessDay[] | null>(null)

  const url = professionalId ? `${endpoint}?professionalId=${professionalId}` : endpoint

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as { availability?: Array<{ weekday: number; startsAt: string; endsAt: string }>; businessHours?: BusinessDay[] | null; error?: string }
      if (!response.ok) { setError(data.error ?? 'No se pudo cargar el horario'); return }
      setBusinessHours(data.businessHours ?? null)
      const next: Week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
      const hours = data.businessHours ?? null
      for (const slot of data.availability ?? []) {
        // Un día que el negocio cerró deja de existir para el profesional: si quedaban tramos
        // viejos se descartan aquí, si no el guardado quedaba bloqueado sin salida.
        if (hours && !hours.find((item) => item.day === slot.weekday)?.enabled) continue
        next[slot.weekday]?.push({ startsAt: slot.startsAt, endsAt: slot.endsAt })
      }
      setWeek(next)
      setError('')
    } catch { setError('No se pudo cargar el horario') } finally { setLoading(false) }
  }, [url])

  useEffect(() => { void load() }, [load])

  const update = (weekday: number, index: number, field: keyof Slot, value: string) =>
    setWeek((current) => ({ ...current, [weekday]: current[weekday].map((slot, position) => position === index ? { ...slot, [field]: value } : slot) }))
  const add = (weekday: number) =>
    setWeek((current) => ({ ...current, [weekday]: [...current[weekday], current[weekday].length ? { startsAt: '15:00', endsAt: '19:00' } : { startsAt: '09:00', endsAt: '18:00' }] }))
  const remove = (weekday: number, index: number) =>
    setWeek((current) => ({ ...current, [weekday]: current[weekday].filter((_, position) => position !== index) }))

  async function save() {
    setSaving(true); setMessage(''); setError('')
    const availability = DAYS.flatMap(([weekday]) => week[weekday].map((slot) => ({ weekday, startsAt: slot.startsAt, endsAt: slot.endsAt })))
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(professionalId ? { professionalId, availability } : { availability }) })
      const data = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) { setError(data.error ?? 'No se pudo guardar el horario'); return }
      setMessage('Horario guardado.')
      onSaved?.()
    } catch { setError('No se pudo guardar el horario') } finally { setSaving(false) }
  }

  if (loading) return <p className="p-4 text-sm text-[#736f83]">Cargando horario…</p>

  const openDay = (weekday: number) => businessHours ? businessHours.find((item) => item.day === weekday) ?? null : null
  const isClosed = (weekday: number) => Boolean(businessHours) && !openDay(weekday)?.enabled

  return <div>
    <div className="space-y-2">
      {DAYS.map(([weekday, label]) => {
        const closed = isClosed(weekday)
        const window = openDay(weekday)
        return <div key={weekday} className={`rounded-xl border p-3 ${closed ? 'border-black/5 bg-[#f6f5fa]' : 'border-black/5'}`}>
          <div className="flex items-center justify-between gap-3">
            <b className={`text-sm ${closed ? 'text-[#9a95ab]' : ''}`}>{label}</b>
            {closed
              ? <span className="inline-flex items-center gap-1 text-xs font-bold text-[#736f83]"><Lock size={13}/>El negocio cierra</span>
              : <button type="button" onClick={() => add(weekday)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold text-[#5b3df5]"><Plus size={14}/>Agregar tramo</button>}
          </div>
          {closed
            ? <p className="mt-2 text-xs text-[#736f83]">Los {WEEKDAY_PLURAL[weekday]} el negocio no abre, así que no se puede atender. Se cambia en Configuración → Horario de atención.</p>
            : week[weekday].length === 0
              ? <p className="mt-2 text-xs text-[#736f83]">No atiende este día.{window ? ` El negocio abre de ${window.start} a ${window.end}.` : ''}</p>
              : <div className="mt-2 space-y-2">{week[weekday].map((slot, index) => <div key={index} className="flex flex-wrap items-center gap-2">
                  <input type="time" min={window?.start} max={window?.end} value={slot.startsAt} onChange={(event) => update(weekday, index, 'startsAt', event.target.value)} className="rounded-lg border p-2 text-sm"/>
                  <span className="text-sm text-[#736f83]">a</span>
                  <input type="time" min={window?.start} max={window?.end} value={slot.endsAt} onChange={(event) => update(weekday, index, 'endsAt', event.target.value)} className="rounded-lg border p-2 text-sm"/>
                  <button type="button" aria-label="Quitar tramo" onClick={() => remove(weekday, index)} className="rounded-lg border p-2 text-[#736f83]"><Trash2 size={15}/></button>
                  {window && (slot.startsAt < window.start || slot.endsAt > window.end) && <span className="text-xs font-bold text-red-700">Fuera del horario del negocio ({window.start}–{window.end})</span>}
                </div>)}</div>}
        </div>
      })}
    </div>
    {error && <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle size={18} className="shrink-0"/><span>{error}</span></p>}
    {message && <p role="status" className="mt-3 flex items-start gap-2 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-800"><CheckCircle2 size={18} className="shrink-0"/><span>{message}</span></p>}
    <button type="button" onClick={() => void save()} disabled={saving} className="mt-4 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar horario'}</button>
    <p className="mt-2 text-xs text-[#736f83]">Sin horario cargado no se generan cupos: ni el portal del cliente ni el agente pueden reservar.</p>
  </div>
}
