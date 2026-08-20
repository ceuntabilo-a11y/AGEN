'use client'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { ModalShell } from '@/components/ModalShell'

type Opcion = { id: string; name?: string; display_name?: string }

/**
 * Alta de un servicio.
 *
 * El modal necesita el catálogo del negocio (especialidades y profesionales) y lo pide al
 * abrirse. Antes no contaba nada de esa espera: durante el segundo que tarda, la especialidad
 * —que es obligatoria— aparecía como un desplegable con una sola opción vacía, y los
 * profesionales como una lista sin nada. Si además la petición fallaba, se quedaba así para
 * siempre, sin un solo mensaje: el formulario parecía roto y no había forma de saber por qué.
 *
 * Ahora se dice en qué estado está, se puede reintentar, y no se deja enviar hasta que hay
 * catálogo — enviarlo sin especialidad solo produce un 400 que el usuario no ha causado.
 */
export function NewServiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [especialidades, setEspecialidades] = useState<Opcion[]>([])
  const [profesionales, setProfesionales] = useState<Opcion[]>([])
  const [cargando, setCargando] = useState(true)
  const [falloCatalogo, setFalloCatalogo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const cargarCatalogo = useCallback(() => {
    setCargando(true)
    setFalloCatalogo(false)
    return fetch('/api/admin/catalog')
      .then(async (respuesta) => { if (!respuesta.ok) throw new Error(); return respuesta.json() })
      .then((datos) => {
        setEspecialidades(datos.specialties ?? [])
        setProfesionales(datos.professionals ?? [])
      })
      .catch(() => setFalloCatalogo(true))
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => { void cargarCatalogo() }, [cargarCatalogo])

  async function submit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setGuardando(true)
    setError('')
    const campos = new FormData(evento.currentTarget)
    const respuesta = await fetch('/api/admin/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specialtyId: campos.get('specialtyId'),
        name: campos.get('name'),
        description: campos.get('description'),
        durationMinutes: Number(campos.get('duration')),
        bufferAfterMinutes: Number(campos.get('buffer') || 0),
        price: Number(campos.get('price') || 0),
        materialCost: Number(campos.get('cost') || 0),
        depositAmount: Number(campos.get('deposit') || 0),
        professionalIds: campos.getAll('professionalIds'),
      }),
    })
    const datos = await respuesta.json().catch(() => ({}))
    if (!respuesta.ok) { setError(datos.error ?? 'No se pudo crear'); setGuardando(false); return }
    onCreated()
    onClose()
  }

  const sinCatalogo = cargando || falloCatalogo || especialidades.length === 0

  return (
    <ModalShell titulo="Nuevo servicio" onClose={onClose}>
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6">
        <div className="flex justify-between">
          <div>
            <h2 className="text-xl font-black">Nuevo servicio</h2>
            <p className="text-sm text-[#736f83]">Define precio, costo y profesionales habilitados.</p>
          </div>
        </div>

        {falloCatalogo && (
          <p role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-800">
            No se pudieron cargar las especialidades ni los profesionales.
            <button type="button" onClick={() => void cargarCatalogo()} className="rounded-lg border border-red-300 px-3 py-1 text-xs font-bold">
              Reintentar
            </button>
          </p>
        )}
        {!cargando && !falloCatalogo && especialidades.length === 0 && (
          <p role="alert" className="mt-4 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">
            Este negocio todavía no tiene especialidades. Crea una en Equipo antes de añadir servicios.
          </p>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Nombre
            <input name="name" required className="mt-2 w-full rounded-xl border p-3" />
          </label>
          <label className="text-sm font-semibold">
            Especialidad
            <select name="specialtyId" required disabled={sinCatalogo} className="mt-2 w-full rounded-xl border p-3 disabled:bg-slate-50">
              <option value="">{cargando ? 'Cargando especialidades…' : 'Seleccionar'}</option>
              {especialidades.map((especialidad) => (
                <option key={especialidad.id} value={especialidad.id}>{especialidad.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Duración (min)
            <input name="duration" required type="number" min="5" step="5" className="mt-2 w-full rounded-xl border p-3" />
          </label>
          <label className="text-sm font-semibold">
            Tiempo posterior (min)
            <input name="buffer" type="number" min="0" step="5" className="mt-2 w-full rounded-xl border p-3" />
          </label>
          <label className="text-sm font-semibold">
            Precio
            <input name="price" type="number" min="0" className="mt-2 w-full rounded-xl border p-3" />
          </label>
          <label className="text-sm font-semibold">
            Costo de materiales
            <input name="cost" type="number" min="0" className="mt-2 w-full rounded-xl border p-3" />
          </label>
          <label className="text-sm font-semibold">
            Anticipo
            <input name="deposit" type="number" min="0" className="mt-2 w-full rounded-xl border p-3" />
          </label>
        </div>

        <label className="mt-4 block text-sm font-semibold">
          Descripción
          <textarea name="description" rows={2} className="mt-2 w-full rounded-xl border p-3" />
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Profesionales habilitados</legend>
          {cargando && <p className="mt-2 text-sm text-[#736f83]">Cargando profesionales…</p>}
          {!cargando && profesionales.length === 0 && !falloCatalogo && (
            <p className="mt-2 text-sm text-[#736f83]">Todavía no hay profesionales que habilitar.</p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {profesionales.map((profesional) => (
              <label key={profesional.id} className="flex gap-2 rounded-lg border p-3 text-sm">
                <input type="checkbox" name="professionalIds" value={profesional.id} />
                {profesional.display_name}
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <button disabled={guardando || sinCatalogo} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-60">
          {guardando ? 'Guardando…' : cargando ? 'Cargando…' : 'Crear servicio'}
        </button>
      </form>
    </ModalShell>
  )
}
