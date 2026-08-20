'use client'
import { PageHeader } from '@/components/PageHeader'
import { NewProfessionalModal } from '@/components/NewProfessionalModal'
import { CalendarDays, Clock3, ImagePlus, Pencil, Plus } from 'lucide-react'
import { AvailabilityModal } from '@/components/AvailabilityModal'
import { EditProfessionalModal } from '@/components/EditProfessionalModal'
import { ProfessionalPhotoModal } from '@/components/ProfessionalPhotoModal'
import { useEffect, useState } from 'react'
import { TeamAgentContacts } from '@/components/TeamAgentContacts'
import { SpecialtyEditor } from '@/components/SpecialtyEditor'
import { ListPlaceholder } from '@/components/ListPlaceholder'

type Professional = {
  id: string
  display_name: string
  phone?: string | null
  bio?: string | null
  color: string
  photo_url?: string | null
  commission_percent: number
  branch_id?: string | null
  active: boolean
  professional_specialties: Array<{ specialty_id: string }>
  professional_services: Array<{ service_id: string; active: boolean }>
}

export default function TeamPage() {
  const [items, setItems] = useState<Professional[]>([])
  const [specialties, setSpecialties] = useState<Array<{ id: string; name: string }>>([])
  const [brandColor, setBrandColor] = useState('#5b3df5')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [schedule, setSchedule] = useState<{ id: string; name: string } | null>(null)
  const [editing, setEditing] = useState<Professional | null>(null)
  const [photoFor, setPhotoFor] = useState<Professional | null>(null)

  const load = () => fetch('/api/admin/catalog').then(async (response) => {
    if (!response.ok) throw new Error()
    return response.json()
  }).then((data) => {
    setItems(data.professionals ?? [])
    setSpecialties(data.specialties ?? [])
    setBrandColor(typeof data.business?.settings?.brand_color === 'string' ? data.business.settings.brand_color : '#5b3df5')
    setError(false)
  }).catch(() => setError(true)).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  return <>
    {show && <NewProfessionalModal onClose={() => setShow(false)} onCreated={load}/>}
    {schedule && <AvailabilityModal professionalId={schedule.id} professionalName={schedule.name} onClose={() => setSchedule(null)}/>}
    {editing && <EditProfessionalModal professional={editing} onClose={() => setEditing(null)} onSaved={() => { void load().then(() => setEditing(null)) }}/>}
    {photoFor && <ProfessionalPhotoModal
      professionalId={photoFor.id}
      professionalName={photoFor.display_name}
      brandColor={brandColor}
      specialtyName={specialties.find((specialty) => specialty.id === photoFor.professional_specialties?.[0]?.specialty_id)?.name ?? null}
      onClose={() => setPhotoFor(null)}
      onSaved={() => void load()}
    />}
    <PageHeader title="Equipo" description="Profesionales, especialidades, colores, horarios y comisiones." action={<button onClick={() => setShow(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Agregar profesional</button>}/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para administrar el equipo.</p>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((professional) => {
        const specialty = specialties.find((item) => item.id === professional.professional_specialties?.[0]?.specialty_id)?.name ?? 'Sin especialidad'
        return <article key={professional.id} className={`rounded-2xl border border-black/5 bg-white p-5 shadow-sm ${professional.active ? '' : 'opacity-70'}`}>
          <div className="flex items-center gap-4">
            {professional.photo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={professional.photo_url} alt={professional.display_name} className="h-14 w-14 rounded-2xl object-cover"/>
              : <span className="grid h-14 w-14 place-items-center rounded-2xl text-lg font-black text-white" style={{ background: professional.color }}>{professional.display_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>}
            <div>
              <h2 className="font-extrabold">{professional.display_name}</h2>
              <p className="text-sm text-[#736f83]">{specialty}</p>
            </div>
            {!professional.active && <span className="ml-auto rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700">Inactivo</span>}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-[#f6f5fa] p-3"><b>{professional.professional_services?.filter((service) => service.active).length ?? 0}</b><p className="text-xs text-[#736f83]">servicios</p></div>
            <div className="rounded-xl bg-[#f6f5fa] p-3"><b>{professional.commission_percent}%</b><p className="text-xs text-[#736f83]">comisión</p></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a href={`/admin/agenda?professional=${professional.id}`} className="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-semibold"><CalendarDays size={16}/>Agenda</a>
            <button type="button" onClick={() => setSchedule({ id: professional.id, name: professional.display_name })} className="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-semibold"><Clock3 size={16}/>Horario</button>
            <button type="button" onClick={() => setPhotoFor(professional)} className="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-semibold"><ImagePlus size={16}/>Foto</button>
            <button type="button" onClick={() => setEditing(professional)} className="flex items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-semibold"><Pencil size={16}/>Editar</button>
          </div>
        </article>
      })}
      {items.length === 0 && <ListPlaceholder loading={loading} error={error} className="text-sm text-[#736f83]">Aún no hay profesionales.</ListPlaceholder>}
    </div>
    <SpecialtyEditor onChanged={load}/>
    <TeamAgentContacts/>
  </>
}
