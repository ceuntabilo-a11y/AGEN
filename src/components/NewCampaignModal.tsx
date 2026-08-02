'use client'

import { FormEvent, useState } from 'react'
import { X } from 'lucide-react'

type CampaignDraft = { id:string; name:string; channel:string; content:string; audience?:{segment?:string}; scheduled_at?:string|null }

export function NewCampaignModal({ onClose, onCreated, campaign }: { onClose: () => void; onCreated: () => void; campaign?: CampaignDraft | null }) {
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/campaigns', {
      method: campaign ? 'PATCH' : 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ campaignId:campaign?.id, name:form.get('name'), channel:form.get('channel'), content:form.get('content'), audience:{segment:form.get('segment')}, scheduledAt:form.get('scheduledAt')||null }),
    })
    const data = await response.json()
    if (!response.ok) {
      setError(data.error??'No se pudo guardar')
      setLoading(false)
      return
    }
    onCreated()
    onClose()
  }

  const scheduled = campaign?.scheduled_at ? new Date(campaign.scheduled_at).toISOString().slice(0,16) : ''
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form onSubmit={submit} className="w-full max-w-xl rounded-3xl bg-white p-6"><div className="flex justify-between"><div><h2 className="text-xl font-black">{campaign?'Editar campaña':'Nueva campaña'}</h2><p className="text-sm text-[#736f83]">Solo se enviará a clientes con consentimiento vigente.</p></div><button aria-label="Cerrar" type="button" onClick={onClose}><X/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Nombre<input name="name" required defaultValue={campaign?.name??''} className="mt-2 w-full rounded-xl border p-3"/></label><label className="text-sm font-semibold">Canal<select name="channel" defaultValue={campaign?.channel??'WHATSAPP'} className="mt-2 w-full rounded-xl border p-3"><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="INSTAGRAM">Instagram</option><option value="MESSENGER">Messenger</option><option value="PUSH">Notificación</option></select></label><label className="text-sm font-semibold">Segmento<select name="segment" defaultValue={campaign?.audience?.segment??'ALL'} className="mt-2 w-full rounded-xl border p-3"><option value="ALL">Todos con consentimiento</option><option value="ACTIVE">Clientes activos</option><option value="INACTIVE">Clientes inactivos</option><option value="BIRTHDAY">Cumpleaños del mes</option></select></label><label className="text-sm font-semibold">Programar<input name="scheduledAt" type="datetime-local" defaultValue={scheduled} className="mt-2 w-full rounded-xl border p-3"/></label></div><label className="mt-4 block text-sm font-semibold">Mensaje<textarea name="content" required maxLength={1500} rows={5} defaultValue={campaign?.content??''} className="mt-2 w-full rounded-xl border p-3"/></label>{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}<button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading?'Guardando…':campaign?'Guardar cambios':'Crear campaña'}</button></form></div>
}
