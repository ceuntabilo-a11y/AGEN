'use client'

import { PageHeader } from '@/components/PageHeader'
import { money } from '@/lib/money'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'
import { ArrowLeft, CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { NewAppointmentModal } from '@/components/NewAppointmentModal'
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal'

type Detail = {
  client: any
  appointments: any[]
  consents: Array<{ channel: string; purpose: string; granted: boolean }>
  quotes: any[]
  payments: any[]
  stats: { total: number; completed: number; cancelled: number; noShow: number; paid: number }
  timezone: string
  currency: string
}

const STATUS: Record<string, string> = { PENDING: 'Pendiente', CONFIRMED: 'Confirmada', CHECKED_IN: 'Llegó', IN_PROGRESS: 'En curso', COMPLETED: 'Completada', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió' }
const CHANNELS: Array<[string, string]> = [['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Correo'], ['SMS', 'SMS']]
const rangeStart = (value: string) => new Date(value.replace(/[[\]()"]/g, '').split(',')[0])

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState('')
  const [booking, setBooking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/clients/${params.id}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { setError(body.error ?? 'No se pudo cargar el cliente'); return }
      setData(body)
      setError('')
    } catch { setError('No se pudo cargar el cliente') }
  }, [params.id])

  useEffect(() => { void load() }, [load])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/clients', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: params.id, changes: { full_name: form.get('fullName'), phone: form.get('phone'), email: form.get('email'), birthday: form.get('birthday'), notes: form.get('notes'), marketing_opt_in: form.get('marketing') === 'on' } }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setMessage(body.error ?? 'No se pudo guardar'); return }
    setEditing(false)
    setMessage('Cambios guardados.')
    void load()
  }

  async function toggleConsent(channel: string, granted: boolean) {
    const response = await fetch(`/api/admin/clients/${params.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, purpose: 'MARKETING', granted }) })
    if (response.ok) void load()
    else setMessage('No se pudo actualizar el consentimiento')
  }

  async function remove() {
    const response = await fetch(`/api/admin/clients?id=${params.id}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    setConfirmingDelete(false)
    if (!response.ok) { setMessage(body.error ?? 'No se pudo eliminar'); return }
    router.push('/admin/clientes')
  }

  if (error) return <><PageHeader title="Cliente" description="Ficha del cliente."/><p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p></>
  if (!data) return <p className="text-sm text-[#736f83]">Cargando ficha…</p>

  const { client, stats } = data
  const memory = Array.isArray(client.client_memory) ? client.client_memory[0] : client.client_memory
  const granted = (channel: string) => data.consents.some((consent) => consent.channel === channel && consent.purpose === 'MARKETING' && consent.granted)

  return <>
    {confirmingDelete && <ConfirmDeleteModal
      title="Eliminar cliente"
      description="Se borra la ficha completa con sus notas y permisos. Solo es posible si no tiene reservas ni pagos registrados."
      detail={client.full_name}
      onCancel={() => setConfirmingDelete(false)}
      onConfirm={remove}
    />}
    {booking && <NewAppointmentModal initialClientId={client.id} timezone={data.timezone} onClose={() => setBooking(false)} onCreated={() => { setBooking(false); setMessage('Reserva creada.'); void load() }}/>}
    <Link href="/admin/clientes" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#5b3df5]"><ArrowLeft size={16}/>Volver a clientes</Link>
    <PageHeader title={client.full_name} description={[client.phone, client.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'} action={<div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setBooking(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><CalendarPlus size={16}/>Reservar</button>
      <button type="button" onClick={() => setEditing((value) => !value)} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold"><Pencil size={16}/>{editing ? 'Cancelar' : 'Editar'}</button>
    </div>}/>

    {message && <p className="mb-4 rounded-xl bg-violet-50 p-3 text-sm text-violet-800">{message}</p>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Reservas</p><b className="text-2xl">{stats.total}</b></article>
      <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Completadas</p><b className="text-2xl text-emerald-600">{stats.completed}</b></article>
      <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">No asistió</p><b className="text-2xl text-red-600">{stats.noShow}</b></article>
      <article className="rounded-2xl border border-black/5 bg-white p-5"><p className="text-xs uppercase text-[#736f83]">Pagado</p><b className="text-2xl">{money(stats.paid, data.currency)}</b></article>
    </section>

    {editing && <form onSubmit={save} className="mt-6 rounded-2xl border bg-white p-6">
      <h2 className="font-extrabold">Datos del cliente</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Nombre<input name="fullName" defaultValue={client.full_name} required className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Teléfono<input name="phone" type="tel" defaultValue={client.phone ?? ''} placeholder="+56 9 1234 5678" className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Correo<input name="email" type="email" defaultValue={client.email ?? ''} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Nacimiento<input name="birthday" type="date" defaultValue={client.birthday ?? ''} className="mt-2 w-full rounded-xl border p-3"/></label>
      </div>
      <label className="mt-4 block text-sm font-semibold">Notas internas<textarea name="notes" defaultValue={client.notes ?? ''} rows={3} className="mt-2 w-full rounded-xl border p-3"/></label>
      <label className="mt-4 flex items-center gap-3 text-sm font-semibold"><input name="marketing" type="checkbox" defaultChecked={client.marketing_opt_in}/>Acepta promociones</label>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white">Guardar cambios</button>
        <button type="button" onClick={() => setConfirmingDelete(true)} className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-5 py-3 font-bold text-red-700"><Trash2 size={16}/>Eliminar cliente</button>
      </div>
    </form>}

    <section className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_.6fr]">
      <article className="rounded-2xl border border-black/5 bg-white p-5">
        <h2 className="font-extrabold">Historial de reservas</h2>
        <div className="mt-4 space-y-2">
          {data.appointments.map((appointment) => {
            const start = rangeStart(appointment.service_period)
            return <div key={appointment.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-black/5 p-3">
              <span className="h-9 w-1 rounded-full" style={{ background: appointment.professional?.color ?? '#5b3df5' }}/>
              <b className="text-sm">{formatInZone(start, data.timezone, { day: 'numeric', month: 'short', year: 'numeric' })} · {formatTimeInZone(start, data.timezone)}</b>
              <span className="min-w-0 flex-1 truncate text-sm text-[#736f83]">{appointment.service?.name} · {appointment.professional?.display_name}</span>
              <span className="text-sm font-semibold">{money(Number(appointment.quoted_price), data.currency)}</span>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{STATUS[appointment.status] ?? appointment.status}</span>
            </div>
          })}
          {data.appointments.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Este cliente todavía no tiene reservas.</p>}
        </div>
      </article>

      <div className="space-y-6">
        <article className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Permisos de marketing</h2>
          <p className="mt-1 text-sm text-[#736f83]">Sin permiso vigente no se le envía ninguna campaña.</p>
          <div className="mt-4 space-y-2">
            {CHANNELS.map(([channel, label]) => <label key={channel} className="flex items-center justify-between rounded-xl border border-black/5 p-3 text-sm font-semibold">
              {label}
              <input type="checkbox" checked={granted(channel)} onChange={(event) => void toggleConsent(channel, event.target.checked)}/>
            </label>)}
          </div>
        </article>

        <article className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Lo que sabe el agente</h2>
          {memory?.conversation_summary
            ? <p className="mt-3 text-sm leading-6 text-[#4b4761]">{memory.conversation_summary}</p>
            : <p className="mt-3 text-sm text-[#736f83]">El agente todavía no ha conversado con este cliente.</p>}
          {memory?.last_interaction_at && <p className="mt-3 text-xs text-[#736f83]">Última conversación: {formatInZone(new Date(memory.last_interaction_at), data.timezone, { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
        </article>

        {client.notes && !editing && <article className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="font-extrabold">Notas internas</h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#4b4761]">{client.notes}</p>
        </article>}
      </div>
    </section>
  </>
}
