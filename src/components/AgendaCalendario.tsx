'use client'
import { useMemo } from 'react'
import type { BusinessDay } from '@/lib/business-hours'
import {
  aHoraTexto,
  ahoraEnElDia,
  descansos,
  horasDelEje,
  huecosLibres,
  posicion,
  tramoDelDia,
  tramosDeTrabajo,
  unir,
  ventanaComun,
  ventanaDelDia,
  type Tramo,
  type TramoSemanal,
} from '@/lib/agenda-calendario'
import { formatInZone } from '@/lib/timezone'

/**
 * Agenda de verdad: eje de horas, citas colocadas por hora y con su duración a escala,
 * descansos, bloqueos, huecos libres y los días en que no se atiende.
 *
 * Sustituye a la lista de "próximos siete días", que no era una agenda: no se veía a qué hora
 * caía cada cosa, ni cuánto duraba, ni qué ratos quedaban libres, que es exactamente para lo
 * que un profesional abre su agenda.
 *
 * Toda la aritmética vive en `@/lib/agenda-calendario` y se prueba sin navegador. Acá solo se
 * pinta. Las horas se calculan siempre en la zona del negocio, nunca en la del navegador.
 */

export type CitaAgenda = {
  id: string
  inicio: string
  fin: string
  titulo: string
  subtitulo?: string | null
  estado: string
  confirmada?: boolean
  color?: string | null
}

export type BloqueoAgenda = { id: string; inicio: string; fin: string; motivo?: string | null }

type Props = {
  vista: 'dia' | 'semana'
  /** Día mostrado (vista día) o día dentro de la semana mostrada. */
  dateKey: string
  dias: string[]
  timeZone: string
  citas: CitaAgenda[]
  bloqueos: BloqueoAgenda[]
  disponibilidad: TramoSemanal[]
  horarioNegocio: BusinessDay[] | null
  onAbrirCita: (id: string) => void
  onHuecoLibre?: (dateKey: string, desde: string, hasta: string) => void
}

/** Colores por estado. Un vistazo tiene que bastar para saber cómo va el día. */
const ESTILO_ESTADO: Record<string, { fondo: string; borde: string; texto: string }> = {
  PENDING: { fondo: 'bg-violet-50', borde: 'border-l-[#7c5cff]', texto: 'text-[#2c2545]' },
  CONFIRMED: { fondo: 'bg-emerald-50', borde: 'border-l-emerald-500', texto: 'text-emerald-900' },
  CHECKED_IN: { fondo: 'bg-sky-50', borde: 'border-l-sky-500', texto: 'text-sky-900' },
  IN_PROGRESS: { fondo: 'bg-amber-50', borde: 'border-l-amber-500', texto: 'text-amber-900' },
  COMPLETED: { fondo: 'bg-slate-100', borde: 'border-l-slate-400', texto: 'text-slate-600' },
  NO_SHOW: { fondo: 'bg-red-50', borde: 'border-l-red-400', texto: 'text-red-800' },
  CANCELLED: { fondo: 'bg-slate-50', borde: 'border-l-slate-300', texto: 'text-slate-400' },
}

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDING: 'Sin confirmar',
  CONFIRMED: 'Confirmada',
  CHECKED_IN: 'Llegó',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  NO_SHOW: 'No asistió',
  CANCELLED: 'Cancelada',
}

export function AgendaCalendario({
  vista, dias, timeZone, citas, bloqueos, disponibilidad, horarioNegocio, onAbrirCita, onHuecoLibre,
}: Props) {
  const porDia = useMemo(() => dias.map((dia) => {
    const trabajo = tramosDeTrabajo(dia, disponibilidad, horarioNegocio)
    const citasDelDia = citas
      .map((cita) => ({ cita, tramo: tramoDelDia(cita.inicio, cita.fin, dia, timeZone) }))
      .filter((item): item is { cita: CitaAgenda; tramo: Tramo } => item.tramo !== null)
    const bloqueosDelDia = bloqueos
      .map((bloqueo) => ({ bloqueo, tramo: tramoDelDia(bloqueo.inicio, bloqueo.fin, dia, timeZone) }))
      .filter((item): item is { bloqueo: BloqueoAgenda; tramo: Tramo } => item.tramo !== null)

    const ocupado = unir([
      ...citasDelDia.filter(({ cita }) => cita.estado !== 'CANCELLED').map(({ tramo }) => tramo),
      ...bloqueosDelDia.map(({ tramo }) => tramo),
    ])
    return {
      dia,
      trabajo,
      pausas: descansos(trabajo),
      citas: citasDelDia,
      bloqueos: bloqueosDelDia,
      libres: huecosLibres(trabajo, ocupado),
      cerrado: trabajo.length === 0,
      ventana: ventanaDelDia(trabajo, [...citasDelDia.map((i) => i.tramo), ...bloqueosDelDia.map((i) => i.tramo)]),
    }
  }), [dias, disponibilidad, horarioNegocio, citas, bloqueos, timeZone])

  // Una sola franja para todas las columnas: si cada día tuviera la suya, las 10:00 estarían a
  // distinta altura en cada columna y la semana no se podría leer de un vistazo.
  const ventana = useMemo(() => ventanaComun(porDia.map((item) => item.ventana)), [porDia])
  const horas = horasDelEje(ventana)
  const altoPx = Math.max(420, Math.round(((ventana.hasta - ventana.desde) / 60) * (vista === 'dia' ? 68 : 52)))

  return (
    <div className="overflow-x-auto rounded-2xl border bg-white">
      <div className={vista === 'semana' ? 'min-w-[720px]' : ''}>
        {/* Cabecera con los días */}
        <div className="grid border-b" style={{ gridTemplateColumns: `56px repeat(${dias.length}, minmax(0,1fr))` }}>
          <div />
          {porDia.map(({ dia, cerrado }) => (
            <div key={dia} className={`border-l px-2 py-2 text-center ${cerrado ? 'bg-slate-50' : ''}`}>
              <p className="text-[11px] uppercase tracking-wide text-[#736f83]">
                {formatInZone(`${dia}T12:00:00Z`, 'UTC', { weekday: 'short' })}
              </p>
              <p className="text-sm font-extrabold text-[#2c2545]">
                {formatInZone(`${dia}T12:00:00Z`, 'UTC', { day: 'numeric', month: 'short' })}
              </p>
              {cerrado && <p className="text-[10px] font-bold text-slate-500">No atiendes</p>}
            </div>
          ))}
        </div>

        {/* Lienzo */}
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${dias.length}, minmax(0,1fr))`, height: `${altoPx}px` }}>
          {/* Eje de horas */}
          <div className="relative">
            {horas.map((minuto) => {
              const { top } = posicion({ desde: minuto, hasta: minuto }, ventana)
              return (
                <span key={minuto} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-[#9a94ad]" style={{ top: `${top}%` }}>
                  {aHoraTexto(minuto)}
                </span>
              )
            })}
          </div>

          {porDia.map(({ dia, trabajo, pausas, citas: citasDelDia, bloqueos: bloqueosDelDia, libres, cerrado }) => {
            const ahora = ahoraEnElDia(dia, timeZone)
            return (
              <div key={dia} className={`relative border-l ${cerrado ? 'bg-slate-50' : 'bg-slate-50/60'}`}>
                {/* Franja de trabajo: el resto queda gris, que es "no atiendo" */}
                {trabajo.map((tramo, indice) => {
                  const { top, alto } = posicion(tramo, ventana)
                  return <div key={`t${indice}`} className="absolute inset-x-0 bg-white" style={{ top: `${top}%`, height: `${alto}%` }} />
                })}

                {/* Líneas de las horas en punto */}
                {horas.map((minuto) => {
                  const { top } = posicion({ desde: minuto, hasta: minuto }, ventana)
                  return <div key={`h${minuto}`} className="absolute inset-x-0 border-t border-black/5" style={{ top: `${top}%` }} />
                })}

                {/* Descansos dentro de la jornada */}
                {pausas.map((tramo, indice) => {
                  const { top, alto } = posicion(tramo, ventana)
                  return (
                    <div
                      key={`p${indice}`}
                      title={`Descanso ${aHoraTexto(tramo.desde)}–${aHoraTexto(tramo.hasta)}`}
                      className="absolute inset-x-0 bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)]"
                      style={{ top: `${top}%`, height: `${alto}%` }}
                    />
                  )
                })}

                {/* Huecos libres: se pueden pulsar para bloquear ese rato */}
                {libres.map((tramo, indice) => {
                  const { top, alto } = posicion(tramo, ventana)
                  const desde = aHoraTexto(tramo.desde)
                  const hasta = aHoraTexto(tramo.hasta)
                  return (
                    <button
                      key={`l${indice}`}
                      type="button"
                      onClick={() => onHuecoLibre?.(dia, desde, hasta)}
                      title={`Libre ${desde}–${hasta}`}
                      aria-label={`Libre de ${desde} a ${hasta}. Bloquear este rato.`}
                      className="group absolute inset-x-1 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 text-left hover:border-emerald-400 hover:bg-emerald-50"
                      style={{ top: `${top}%`, height: `${alto}%` }}
                    >
                      {tramo.hasta - tramo.desde >= 45 && (
                        <span className="pointer-events-none absolute inset-x-0 top-1 text-center text-[10px] font-bold text-emerald-700 opacity-0 group-hover:opacity-100">
                          Libre · bloquear
                        </span>
                      )}
                    </button>
                  )
                })}

                {/* Bloqueos */}
                {bloqueosDelDia.map(({ bloqueo, tramo }) => {
                  const { top, alto } = posicion(tramo, ventana)
                  return (
                    <div
                      key={bloqueo.id}
                      title={`Bloqueado ${aHoraTexto(tramo.desde)}–${aHoraTexto(tramo.hasta)}${bloqueo.motivo ? ` · ${bloqueo.motivo}` : ''}`}
                      className="absolute inset-x-1 overflow-hidden rounded-lg border border-slate-300 bg-[repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_5px,#cbd5e1_5px,#cbd5e1_10px)] px-2 py-1"
                      style={{ top: `${top}%`, height: `${alto}%` }}
                    >
                      <p className="truncate text-[11px] font-bold text-slate-700">
                        {bloqueo.motivo || 'Bloqueado'}
                      </p>
                    </div>
                  )
                })}

                {/* Citas */}
                {citasDelDia.map(({ cita, tramo }) => {
                  const { top, alto } = posicion(tramo, ventana)
                  const estilo = ESTILO_ESTADO[cita.estado] ?? ESTILO_ESTADO.PENDING
                  // Qué cabe según lo que dura: media hora da para la hora y el nombre; menos,
                  // solo para la hora. Meter tres líneas donde caben dos las corta a la mitad.
                  const minutos = tramo.hasta - tramo.desde
                  const cabeNombre = minutos >= 25
                  // 45 minutos parecían suficientes para la tercera línea y no lo son: en vista
                  // Semana esa caja mide ~39 px y el servicio quedaba cortado por la mitad.
                  const cabeServicio = minutos >= 60
                  return (
                    <button
                      key={cita.id}
                      type="button"
                      onClick={() => onAbrirCita(cita.id)}
                      aria-label={`${aHoraTexto(tramo.desde)} a ${aHoraTexto(tramo.hasta)}, ${cita.titulo}. ${ETIQUETA_ESTADO[cita.estado] ?? cita.estado}. Ver detalle.`}
                      className={`absolute inset-x-1 overflow-hidden rounded-lg border border-black/5 border-l-4 px-2 py-1 text-left shadow-sm transition hover:shadow-md ${estilo.fondo} ${estilo.borde} ${estilo.texto}`}
                      style={{ top: `${top}%`, height: `${alto}%` }}
                    >
                      <p className="truncate text-[11px] font-extrabold tabular-nums">
                        {aHoraTexto(tramo.desde)}–{aHoraTexto(tramo.hasta)}
                        {cita.confirmada && <span title="Confirmada por el cliente"> ✓</span>}
                      </p>
                      {cabeNombre && <p className="truncate text-xs font-bold">{cita.titulo}</p>}
                      {cabeServicio && cita.subtitulo && <p className="truncate text-[11px] opacity-80">{cita.subtitulo}</p>}
                    </button>
                  )
                })}

                {/* Ahora */}
                {ahora !== null && ahora >= ventana.desde && ahora <= ventana.hasta && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                    style={{ top: `${posicion({ desde: ahora, hasta: ahora }, ventana).top}%` }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Leyenda: sin ella el rayado y los colores hay que adivinarlos. */
export function LeyendaAgenda() {
  const items = [
    { clase: 'bg-violet-50 border-l-4 border-l-[#7c5cff]', texto: 'Sin confirmar' },
    { clase: 'bg-emerald-50 border-l-4 border-l-emerald-500', texto: 'Confirmada' },
    { clase: 'bg-sky-50 border-l-4 border-l-sky-500', texto: 'Llegó' },
    { clase: 'bg-amber-50 border-l-4 border-l-amber-500', texto: 'En curso' },
    { clase: 'border border-dashed border-emerald-300 bg-emerald-50/40', texto: 'Libre' },
    { clase: 'bg-[repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_5px,#cbd5e1_5px,#cbd5e1_10px)]', texto: 'Bloqueado' },
    { clase: 'bg-[repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9_6px,#e2e8f0_6px,#e2e8f0_12px)]', texto: 'Descanso' },
  ]
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#736f83]">
      {items.map((item) => (
        <span key={item.texto} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-5 rounded ${item.clase}`} />
          {item.texto}
        </span>
      ))}
    </div>
  )
}
