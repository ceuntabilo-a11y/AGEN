'use client'
import { FormEvent, useState } from 'react'
import { X } from 'lucide-react'
import { ModalShell } from '@/components/ModalShell'
import { zonedDateTimeToUtc } from '@/lib/timezone'

/**
 * Bloquear un rato de la agenda.
 *
 * `timeZone` no es opcional por comodidad: un `datetime-local` no lleva zona, así que
 * `new Date(valor)` lo interpreta en la del NAVEGADOR. Un profesional escribiendo "15:00"
 * desde otro huso —de viaje, o con el sistema mal configurado— acababa bloqueando otra hora
 * distinta de la que veía en pantalla. La zona del negocio es la fuente de verdad
 * (CLAUDE.md §1) y la conversión la hace `zonedDateTimeToUtc`.
 *
 * `desdePorDefecto` / `hastaPorDefecto` vienen del hueco libre que se pulsó en el calendario,
 * en formato `YYYY-MM-DDTHH:MM`, para no obligar a teclear dos fechas completas.
 */
export function NewBlockModal({
  onClose, onCreated, timeZone, desdePorDefecto, hastaPorDefecto,
}: {
  onClose: () => void
  onCreated: () => void
  timeZone: string
  desdePorDefecto?: string
  hastaPorDefecto?: string
}) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  /** `YYYY-MM-DDTHH:MM` en la zona del negocio → instante UTC. */
  function aUtc(valor: string): string | null {
    const [dateKey, hora] = String(valor).split('T')
    if (!dateKey || !hora) return null
    const fecha = zonedDateTimeToUtc(dateKey, `${hora}:00`.slice(0, 8), timeZone)
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const f = new FormData(e.currentTarget)
    const from = aUtc(String(f.get('from')))
    const until = aUtc(String(f.get('until')))
    if (!from || !until) { setError('Revisa las fechas'); return }
    if (until <= from) { setError('La hora de término tiene que ser posterior a la de inicio'); return }

    setLoading(true)
    const response = await fetch('/api/professional/blocks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, until, reason: f.get('reason') }),
    })
    const data = await response.json()
    if (!response.ok) { setError(data.error ?? 'No se pudo bloquear'); setLoading(false); return }
    onCreated()
    onClose()
  }

  return (
    <ModalShell titulo="Bloquear horario" onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-6">
        <div className="flex justify-between">
          <h2 className="text-xl font-black">Bloquear horario</h2>
          <button type="button" aria-label="Cerrar" onClick={onClose}><X /></button>
        </div>
        <p className="mt-1 text-sm text-[#736f83]">Horas de {timeZone.split('/').pop()?.replace('_', ' ')}, las del negocio.</p>
        <label className="mt-5 block text-sm font-semibold">
          Desde
          <input name="from" required type="datetime-local" defaultValue={desdePorDefecto} className="mt-2 w-full rounded-xl border p-3" />
        </label>
        <label className="mt-4 block text-sm font-semibold">
          Hasta
          <input name="until" required type="datetime-local" defaultValue={hastaPorDefecto} className="mt-2 w-full rounded-xl border p-3" />
        </label>
        <label className="mt-4 block text-sm font-semibold">
          Motivo
          <input name="reason" className="mt-2 w-full rounded-xl border p-3" placeholder="Descanso, capacitación, permiso…" />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-60">
          {loading ? 'Guardando…' : 'Bloquear horario'}
        </button>
      </form>
    </ModalShell>
  )
}
