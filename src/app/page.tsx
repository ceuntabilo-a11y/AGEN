import { ArrowRight, Bot, CalendarDays, ChartNoAxesCombined, ShieldCheck, UsersRound } from 'lucide-react'
import Link from 'next/link'
import { formatInZone } from '@/lib/timezone'

const professionals = [
  { name: 'Valentina', specialty: 'Peluquería', color: '#7c5cff', appointments: 6 },
  { name: 'Camila', specialty: 'Peluquería', color: '#ff6f91', appointments: 5 },
  { name: 'Isabella', specialty: 'Manicure', color: '#17b890', appointments: 7 },
  { name: 'Martina', specialty: 'Pedicure', color: '#ff9f43', appointments: 4 },
  { name: 'Sofía', specialty: 'Masajes', color: '#2d9cdb', appointments: 3 },
]

// La portada se sirve en cada visita para que la fecha del ejemplo sea siempre la de hoy.
export const dynamic = 'force-dynamic'

export default function Home() {
  const hoy = formatInZone(new Date(), 'America/Santiago', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <main className="min-h-screen px-5 py-6 md:px-10 lg:px-16">
      <nav className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#5b3df5] text-xl font-black text-white shadow-lg shadow-violet-300">A</div>
          <div><div className="text-xl font-black tracking-tight">Agen</div><div className="text-xs text-[#736f83]">Agenda + Agente IA</div></div>
        </div>
        <Link href="/login" className="rounded-full bg-[#19162b] px-5 py-2.5 text-sm font-semibold text-white">Entrar</Link>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-4 py-2 text-sm font-semibold text-[#5b3df5]"><Bot size={17}/> Tu recepcionista inteligente, 24/7</span>
          <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[1.02] tracking-[-0.05em] md:text-7xl">Cada profesional con su agenda. <span className="text-[#5b3df5]">Todo bajo control.</span></h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#736f83]">Agen organiza servicios, equipos, reservas, presupuestos y clientes. Su agente IA ofrece únicamente profesionales realmente habilitados y horarios confirmados por el sistema.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/crear-negocio" className="inline-flex items-center gap-2 rounded-2xl bg-[#5b3df5] px-6 py-3.5 font-bold text-white shadow-xl shadow-violet-200">Comenzar con Agen <ArrowRight size={18}/></Link>
            <Link href="/login" className="rounded-2xl border border-black/10 bg-white/70 px-6 py-3.5 font-bold">Ver agenda</Link>
          </div>
        </div>

        <div className="rounded-[2rem] border border-white bg-[rgba(255,255,255,.82)] p-5 shadow-2xl shadow-violet-200/50 backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-black/5 pb-4">
            <div><p className="text-sm text-[#736f83]">Agenda general</p><h2 className="text-xl font-extrabold capitalize">{hoy}</h2></div>
            <CalendarDays className="text-[#5b3df5]" />
          </div>
          <div className="mt-5 space-y-3">
            {professionals.map((professional, index) => (
              <div key={professional.name} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
                <span className="h-11 w-1.5 rounded-full" style={{ backgroundColor: professional.color }} />
                <div className="min-w-0 flex-1"><p className="font-bold">{professional.name}</p><p className="text-sm text-[#736f83]">{professional.specialty}</p></div>
                <div className="text-right"><p className="font-bold">{9 + index}:00</p><p className="text-xs text-[#736f83]">{professional.appointments} reservas</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 pb-16 md:grid-cols-3">
        {[
          [ShieldCheck, 'Disponibilidad protegida', 'La base de datos impide reservas fuera de horario o solapadas.'],
          [UsersRound, 'Especialidades exactas', 'Peluquería muestra peluqueras; manicure muestra manicuristas.'],
          [ChartNoAxesCombined, 'Costos y rentabilidad', 'Precios, materiales, comisiones, anticipos y margen real.'],
        ].map(([Icon, title, text]) => {
          const FeatureIcon = Icon as typeof ShieldCheck
          return <article key={String(title)} className="rounded-3xl border border-white bg-white/65 p-6 backdrop-blur"><FeatureIcon className="text-[#5b3df5]"/><h3 className="mt-5 text-lg font-extrabold">{String(title)}</h3><p className="mt-2 leading-7 text-[#736f83]">{String(text)}</p></article>
        })}
      </section>
    </main>
  )
}
