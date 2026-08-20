'use client'
import { PageHeader } from '@/components/PageHeader'
import { Activity, Building2, CircleDollarSign, Clock3, Gift, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Resumen de plataforma: el estado comercial y operativo de Agen de un vistazo.
 *
 * Antes eran cuatro números —negocios, profesionales, MRR y dos semáforos— y con eso no se
 * puede contestar la pregunta que se hace quien vende: «esta semana entregué 50 demos, ¿cuántas
 * siguen vivas y cuántas se convirtieron?». Todo lo de acá sale de datos reales; no hay ninguna
 * cifra estimada ni decorativa.
 */

type Servicio = 'OPERATIVO' | 'CAIDO' | 'SIN_CONFIGURAR'

type Resumen = {
  negocios: { total: number; activos: number; demos: number; vencidos: number; suspendidos: number; inactivos: number; nuevosSemana: number; nuevosMes: number }
  demos: {
    entregadas: number; activas: number; vencidas: number; convertidas: number; conversion: number
    nuevasSemana: number; nuevasMes: number
    lista: Array<{ id: string; nombre: string | null; inicio: string | null; vence: string | null; restantes: number | null; estado: string; convertida: boolean }>
  }
  ingresos: { mensualesRecurrentes: number; porPlan: Array<{ plan: string; negocios: number; ingresos: number }> }
  vencimientos: Array<{ id: string; nombre: string | null; esDemo: boolean; vence: string | null; restantes: number | null }>
  operacion: { profesionales: number; citas: number }
  salud: { supabase: Servicio; n8n: Servicio }
}

const dinero = (valor: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(valor)

const fecha = (valor: string | null) =>
  valor ? new Date(`${valor}T00:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '—'

/** Cuánto le queda, dicho como lo diría una persona. */
function restante(dias: number | null) {
  if (dias === null) return 'Sin vencimiento'
  if (dias < 0) return `Venció hace ${Math.abs(dias)} d`
  if (dias === 0) return 'Vence hoy'
  if (dias === 1) return 'Queda 1 día'
  return `Quedan ${dias} días`
}

const SEMAFORO: Record<Servicio, { texto: string; clase: string }> = {
  OPERATIVO: { texto: 'Operativo', clase: 'bg-emerald-50 text-emerald-700' },
  CAIDO: { texto: 'Con error', clase: 'bg-red-50 text-red-700' },
  SIN_CONFIGURAR: { texto: 'Sin configurar', clase: 'bg-amber-50 text-amber-800' },
}

function Dato({ etiqueta, valor, pie }: { etiqueta: string; valor: string | number; pie?: string }) {
  return <div className="rounded-xl bg-[#faf9fd] p-3">
    <p className="text-xs text-[#736f83]">{etiqueta}</p>
    <b className="text-2xl">{valor}</b>
    {pie && <p className="mt-0.5 text-xs text-[#9a96a5]">{pie}</p>}
  </div>
}

export default function PlatformOverviewPage() {
  const [data, setData] = useState<Resumen | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/platform/overview', { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json() })
      .then(setData)
      .catch(() => setError('No se pudo cargar el resumen de plataforma.'))
  }, [])

  return <>
    <PageHeader title="Resumen de plataforma" description="El estado comercial y operativo de Agen, con datos reales." />
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    {!data && !error && <p className="text-sm text-[#736f83]">Cargando…</p>}

    {data && <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border bg-white p-5 lg:col-span-2">
          <div className="flex items-center gap-2"><Building2 size={18} className="text-[#5b3df5]" /><b>Negocios</b></div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Dato etiqueta="Total" valor={data.negocios.total} />
            <Dato etiqueta="Activos" valor={data.negocios.activos} />
            <Dato etiqueta="En demo" valor={data.negocios.demos} />
            <Dato etiqueta="Vencidos" valor={data.negocios.vencidos} />
            <Dato etiqueta="Suspendidos" valor={data.negocios.suspendidos} />
            <Dato etiqueta="Inactivos" valor={data.negocios.inactivos} />
          </div>
          <p className="mt-3 text-sm text-[#736f83]">
            Nuevos: <b className="text-[#19162b]">{data.negocios.nuevosSemana}</b> esta semana ·{' '}
            <b className="text-[#19162b]">{data.negocios.nuevosMes}</b> este mes
          </p>
        </article>

        <article className="rounded-2xl border bg-white p-5">
          <div className="flex items-center gap-2"><CircleDollarSign size={18} className="text-[#5b3df5]" /><b>Ingresos mensuales recurrentes estimados</b></div>
          <b className="mt-3 block text-3xl">{dinero(data.ingresos.mensualesRecurrentes)}</b>
          <p className="mt-1 text-xs text-[#9a96a5]">También llamado MRR. Cuenta solo negocios activos: las demos, los vencidos y los suspendidos no pagan.</p>
          {data.ingresos.porPlan.length > 0 && <ul className="mt-3 space-y-1 text-sm">
            {data.ingresos.porPlan.map((fila) => <li key={fila.plan} className="flex justify-between gap-2">
              <span className="truncate text-[#736f83]">{fila.plan} · {fila.negocios}</span>
              <b>{dinero(fila.ingresos)}</b>
            </li>)}
          </ul>}
        </article>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <div className="flex items-center gap-2"><Gift size={18} className="text-[#5b3df5]" /><b>Demos y conversión</b></div>
        <p className="mt-1 text-xs text-[#9a96a5]">Solo negocios marcados como demo al crearlos. &quot;Convertidas&quot; son las que dejaste de marcar como demo porque empezaron a pagar; &quot;Conversión&quot; es ese número sobre el total de demos entregadas — tu tasa real de demo → cliente.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Dato etiqueta="Entregadas" valor={data.demos.entregadas} />
          <Dato etiqueta="Activas" valor={data.demos.activas} />
          <Dato etiqueta="Vencidas" valor={data.demos.vencidas} />
          <Dato etiqueta="Convertidas" valor={data.demos.convertidas} />
          <Dato etiqueta="Conversión" valor={`${data.demos.conversion}%`} pie="sobre entregadas" />
          <Dato etiqueta="Nuevas" valor={data.demos.nuevasSemana} pie={`${data.demos.nuevasMes} este mes`} />
        </div>

        {data.demos.lista.length === 0
          ? <p className="mt-4 text-sm text-[#736f83]">Todavía no has entregado ninguna demo.</p>
          : <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left text-xs uppercase text-[#9a96a5]">
                <th className="pb-2 font-semibold">Negocio</th><th className="pb-2 font-semibold">Inicio</th>
                <th className="pb-2 font-semibold">Vence</th><th className="pb-2 font-semibold">Estado</th>
              </tr></thead>
              <tbody>
                {data.demos.lista.map((demo) => <tr key={demo.id} className="border-t">
                  <td className="py-2 pr-2"><Link href="/plataforma/negocios" className="font-semibold hover:underline">{demo.nombre ?? 'Sin nombre'}</Link></td>
                  <td className="py-2 pr-2 text-[#736f83]">{fecha(demo.inicio)}</td>
                  <td className="py-2 pr-2 text-[#736f83]">{fecha(demo.vence)}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${demo.convertida ? 'bg-emerald-50 text-emerald-700' : demo.estado === 'VENCIDO' ? 'bg-red-50 text-red-700' : 'bg-[#efeaff] text-[#5b3df5]'}`}>
                      {demo.convertida ? 'Convertida' : restante(demo.restantes)}
                    </span>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border bg-white p-5">
          <div className="flex items-center gap-2"><Clock3 size={18} className="text-[#5b3df5]" /><b>Próximos a vencer</b></div>
          {data.vencimientos.length === 0
            ? <p className="mt-3 text-sm text-[#736f83]">Nada vence en los próximos días.</p>
            : <ul className="mt-3 space-y-2 text-sm">
              {data.vencimientos.map((fila) => <li key={fila.id} className="flex items-center justify-between gap-3 border-b pb-2 last:border-0">
                <span className="truncate"><b>{fila.nombre ?? 'Sin nombre'}</b>{fila.esDemo && <span className="ml-2 rounded-full bg-[#efeaff] px-2 py-0.5 text-xs font-bold text-[#5b3df5]">Demo</span>}</span>
                <span className={fila.restantes !== null && fila.restantes <= 2 ? 'shrink-0 font-bold text-red-600' : 'shrink-0 text-[#736f83]'}>{restante(fila.restantes)}</span>
              </li>)}
            </ul>}
        </article>

        <article className="rounded-2xl border bg-white p-5">
          <div className="flex items-center gap-2"><Activity size={18} className="text-[#5b3df5]" /><b>Operación</b></div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Dato etiqueta="Profesionales activos" valor={data.operacion.profesionales} />
            <Dato etiqueta="Citas vigentes" valor={data.operacion.citas} />
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {([['Supabase', data.salud.supabase], ['n8n', data.salud.n8n]] as const).map(([nombre, estado]) => <p key={nombre} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><UsersRound size={14} className="opacity-0" />{nombre}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${SEMAFORO[estado].clase}`}>{SEMAFORO[estado].texto}</span>
            </p>)}
          </div>
          <Link href="/plataforma/monitor" className="mt-3 inline-block text-sm font-semibold text-[#5b3df5] hover:underline">Ver el monitor</Link>
        </article>
      </section>
    </div>}
  </>
}
