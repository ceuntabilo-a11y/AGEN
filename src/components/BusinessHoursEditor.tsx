'use client'

import { DEFAULT_BUSINESS_HOURS, WEEKDAY_NAMES, type BusinessDay } from '@/lib/business-hours'

/**
 * Horario de atención del negocio, día por día.
 *
 * Es la fuente de verdad: si el negocio cierra un día, ese día no se ofrece ni se puede
 * reservar aunque un profesional lo tenga marcado en su horario.
 */
export function BusinessHoursEditor({ value, onChange }: { value: BusinessDay[]; onChange: (next: BusinessDay[]) => void }) {
  const set = (day: number, changes: Partial<BusinessDay>) =>
    onChange(value.map((item) => item.day === day ? { ...item, ...changes } : item))

  const closedAll = value.every((item) => !item.enabled)
  const invalid = value.some((item) => item.enabled && item.start >= item.end)

  return <div className="grid gap-2">
    {value.map((item) => {
      const name = WEEKDAY_NAMES[item.day] ?? ''
      return <div key={item.day} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${item.enabled ? 'bg-white' : 'bg-[#f6f5fa]'}`}>
        <button
          type="button"
          aria-pressed={item.enabled}
          onClick={() => set(item.day, { enabled: !item.enabled })}
          className={`w-28 shrink-0 rounded-lg border px-3 py-2 text-sm font-bold ${item.enabled ? 'border-[#5b3df5] bg-[#5b3df5] text-white' : 'border-black/10 text-[#736f83]'}`}>
          {name}
        </button>
        {item.enabled
          ? <div className="flex flex-1 items-center gap-2">
              <input type="time" aria-label={`${name} abre`} value={item.start} onChange={(event) => set(item.day, { start: event.target.value })} className="w-full rounded-lg border p-2 text-sm"/>
              <span className="text-xs text-[#736f83]">a</span>
              <input type="time" aria-label={`${name} cierra`} value={item.end} onChange={(event) => set(item.day, { end: event.target.value })} className="w-full rounded-lg border p-2 text-sm"/>
            </div>
          : <span className="flex-1 text-sm font-semibold text-[#736f83]">Cerrado</span>}
      </div>
    })}
    <p className="text-xs text-[#736f83]">Pulsa el día para abrirlo o cerrarlo. Manda sobre todo: en un día cerrado no se puede reservar ni desde la agenda, ni desde el agente, ni desde el portal del cliente, aunque un profesional lo tenga en su horario.</p>
    {closedAll && <p className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">Tienes todos los días cerrados: nadie podrá reservar.</p>}
    {invalid && <p className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">Hay días donde la hora de cierre es igual o anterior a la de apertura.</p>}
  </div>
}

export { DEFAULT_BUSINESS_HOURS }
export type { BusinessDay }
