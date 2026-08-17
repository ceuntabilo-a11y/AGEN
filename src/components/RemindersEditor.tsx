'use client'

import { ANTELACIONES, etiquetaDeAntelacion, MAXIMO_RECORDATORIOS, type Reminder } from '@/lib/reminders'

/**
 * Cuándo avisa el negocio a sus clientes. Lo decide el dueño, no el código.
 *
 * Antes había dos avisos fijos («la tarde anterior» y «la mañana del día») y el dueño solo
 * podía mover la hora del reloj. Acá elige cuántos recordatorios manda y con cuánta antelación,
 * y puede apagar cualquiera sin borrarlo.
 */
export function RemindersEditor({ value, onChange }: { value: Reminder[]; onChange: (siguiente: Reminder[]) => void }) {
  const usadas = new Set(value.map((item) => item.hoursBefore))
  const disponibles = ANTELACIONES.filter((horas) => !usadas.has(horas))

  const cambiar = (indice: number, cambio: Partial<Reminder>) =>
    onChange(value.map((item, i) => (i === indice ? { ...item, ...cambio } : item)))

  const quitar = (indice: number) => onChange(value.filter((_, i) => i !== indice))

  const agregar = () => {
    if (!disponibles.length || value.length >= MAXIMO_RECORDATORIOS) return
    onChange([...value, { hoursBefore: disponibles[0], enabled: true }]
      .sort((a, b) => b.hoursBefore - a.hoursBefore))
  }

  return (
    <div className="grid gap-3">
      {!value.length && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Sin recordatorios, el cliente no recibe ningún aviso previo de su hora.
        </p>
      )}

      {value.map((item, indice) => (
        <div key={`${item.hoursBefore}-${indice}`} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(evento) => cambiar(indice, { enabled: evento.target.checked })}
            />
            Activo
          </label>

          <select
            value={item.hoursBefore}
            onChange={(evento) => cambiar(indice, { hoursBefore: Number(evento.target.value) })}
            className="rounded-lg border p-2 text-sm"
            aria-label="Antelación del recordatorio"
          >
            {ANTELACIONES.filter((horas) => horas === item.hoursBefore || !usadas.has(horas)).map((horas) => (
              <option key={horas} value={horas}>{etiquetaDeAntelacion(horas)}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => quitar(indice)}
            className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700"
          >
            Quitar
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={agregar}
        disabled={!disponibles.length || value.length >= MAXIMO_RECORDATORIOS}
        className="justify-self-start rounded-xl border px-4 py-2 text-sm font-bold disabled:opacity-40"
      >
        Agregar recordatorio
      </button>

      <p className="text-xs text-[#736f83]">
        Cada recordatorio le pide al cliente que responda <b>SÍ</b> para confirmar o <b>NO</b> para
        cambiarla; si dice que no, el agente le ofrece horarios nuevos en el mismo mensaje.
      </p>
    </div>
  )
}
