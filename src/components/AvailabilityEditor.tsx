'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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

  const url = professionalId ? `${endpoint}?professionalId=${professionalId}` : endpoint

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const data = await response.json().catch(() => ({})) as { availability?: Array<{ weekday: number; startsAt: string; endsAt: string }>; error?: string }
      if (!response.ok) { setError(data.error ?? 'No se pudo cargar el horario'); return }
      const next: Week = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
      for (const slot of data.availability ?? []) next[slot.weekday]?.push({ startsAt: slot.startsAt, endsAt: slot.endsAt })
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

  return <div>
    <div className="space-y-2">
      {DAYS.map(([weekday, label]) => <div key={weekday} className="rounded-xl border border-black/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <b className="text-sm">{label}</b>
          <button type="button" onClick={() => add(weekday)} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold text-[#5b3df5]"><Plus size={14}/>Agregar tramo</button>
        </div>
        {week[weekday].length === 0
          ? <p className="mt-2 text-xs text-[#736f83]">No atiende este día.</p>
          : <div className="mt-2 space-y-2">{week[weekday].map((slot, index) => <div key={index} className="flex flex-wrap items-center gap-2">
              <input type="time" value={slot.startsAt} onChange={(event) => update(weekday, index, 'startsAt', event.target.value)} className="rounded-lg border p-2 text-sm"/>
              <span className="text-sm text-[#736f83]">a</span>
              <input type="time" value={slot.endsAt} onChange={(event) => update(weekday, index, 'endsAt', event.target.value)} className="rounded-lg border p-2 text-sm"/>
              <button type="button" aria-label="Quitar tramo" onClick={() => remove(weekday, index)} className="rounded-lg border p-2 text-[#736f83]"><Trash2 size={15}/></button>
            </div>)}</div>}
      </div>)}
    </div>
    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    {message && <p className="mt-3 text-sm text-emerald-700">{message}</p>}
    <button type="button" onClick={() => void save()} disabled={saving} className="mt-4 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar horario'}</button>
    <p className="mt-2 text-xs text-[#736f83]">Sin horario cargado no se generan cupos: ni el portal del cliente ni el agente pueden reservar.</p>
  </div>
}
