'use client'

import { PageHeader } from '@/components/PageHeader'
import { NewServiceModal } from '@/components/NewServiceModal'
import { money } from '@/lib/money'
import { Clock3, Pencil, Plus } from 'lucide-react'
import { EditServiceModal } from '@/components/EditServiceModal'
import { useEffect, useState } from 'react'

type Service = {
  id: string
  name: string
  description?: string | null
  duration_minutes: number
  buffer_before_minutes: number
  buffer_after_minutes: number
  price: number
  material_cost: number
  deposit_amount: number
  active: boolean
  specialty: { name: string } | null
  professional_services?: Array<{ professional_id: string }>
}

export default function ServicesPage() {
  const [services,setServices] = useState<Service[]>([])
  const [currency,setCurrency] = useState('CLP')
  const [error,setError] = useState(false)
  const [show,setShow] = useState(false)
  const [editing,setEditing] = useState<Service|null>(null)
  const load = () => fetch('/api/admin/catalog').then(async (response) => {
    if (!response.ok) throw new Error()
    return response.json()
  }).then((data) => {
    setServices(data.services ?? [])
    setCurrency(data.business?.currency ?? 'CLP')
    setError(false)
  }).catch(() => setError(true))

  useEffect(() => { load() }, [])

  return <>
    {show && <NewServiceModal onClose={() => setShow(false)} onCreated={load}/>}
    {editing && <EditServiceModal service={editing} onClose={() => setEditing(null)} onSaved={() => { void load().then(() => setEditing(null)) }}/>}
    <PageHeader title="Servicios" description="Duración, precios, costos y profesionales autorizados." action={<button onClick={() => setShow(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Nuevo servicio</button>}/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para administrar servicios.</p>}
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f7f6fa] text-xs uppercase text-[#736f83]"><tr><th className="p-4">Servicio</th><th>Especialidad</th><th>Duración</th><th>Precio</th><th>Costo</th><th>Margen</th><th></th></tr></thead>
          <tbody>{services.map((service) => <tr key={service.id} className={`border-t border-black/5 ${service.active === false ? 'opacity-60' : ''}`}>
            <td className="p-4 font-bold">{service.name}{service.active === false && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">Inactivo</span>}</td>
            <td><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">{service.specialty?.name}</span></td>
            <td><span className="inline-flex items-center gap-1"><Clock3 size={14}/>{service.duration_minutes} min</span></td>
            <td className="font-semibold">{money(Number(service.price),currency)}</td>
            <td>{money(Number(service.material_cost),currency)}</td>
            <td className="font-bold text-emerald-600">{Number(service.price) > 0 ? Math.round((Number(service.price) - Number(service.material_cost)) / Number(service.price) * 100) : 0}%</td>
            <td className="pr-4 text-right"><button type="button" onClick={() => setEditing(service)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold"><Pencil size={14}/>Editar</button></td>
          </tr>)}</tbody>
        </table>
        {!error && services.length === 0 && <p className="p-8 text-center text-sm text-[#736f83]">Aún no hay servicios.</p>}
      </div>
    </div>
  </>
}
