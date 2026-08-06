'use client'

import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { ImagePlus, Sparkles, X } from 'lucide-react'

type CampaignDraft = { id:string; name:string; channel:string; content:string; subject?:string|null; email_html?:string|null; audience?:{segment?:string}; scheduled_at?:string|null; image_url?:string|null }

export function NewCampaignModal({ onClose, onCreated, campaign }: { onClose: () => void; onCreated: () => void; campaign?: CampaignDraft | null }) {
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [content,setContent] = useState(campaign?.content??'')
  const [description,setDescription] = useState('')
  const [generating,setGenerating] = useState(false)
  const [channel,setChannel] = useState(campaign?.channel??'WHATSAPP')
  const [segment,setSegment] = useState(campaign?.audience?.segment??'ALL')
  const [imageUrl,setImageUrl] = useState(campaign?.image_url??'')
  const [uploading,setUploading] = useState(false)
  const [audience,setAudience] = useState<number|null>(null)
  const [subject,setSubject] = useState(campaign?.subject??'')
  const [emailHtml,setEmailHtml] = useState(campaign?.email_html??'')
  const [designing,setDesigning] = useState(false)

  // Cuánta gente recibiría esto ahora mismo, contando solo consentimientos vigentes.
  useEffect(() => {
    let active = true
    setAudience(null)
    fetch(`/api/admin/campaigns/audience?channel=${channel}&segment=${segment}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data) setAudience(data.count) })
      .catch(() => undefined)
    return () => { active = false }
  }, [channel, segment])

  async function generate() {
    if (!description.trim()) return
    setGenerating(true); setError('')
    const response = await fetch('/api/admin/campaigns/generate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ description, channel }) })
    const data = await response.json()
    if (response.ok) setContent(data.content); else setError(data.error??'No se pudo generar el texto')
    setGenerating(false)
  }

  async function designEmail() {
    if (!content.trim()) { setError('Escribe primero el mensaje'); return }
    setDesigning(true); setError('')
    const response = await fetch('/api/admin/campaigns/generate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mode:'email-design', content, description: content }) })
    const data = await response.json().catch(() => ({}))
    setDesigning(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo diseñar el correo'); return }
    setEmailHtml(data.html ?? '')
    if (data.subject && !subject.trim()) setSubject(data.subject)
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    const form = new FormData()
    form.append('file', file)
    form.append('kind', 'campaign')
    const response = await fetch('/api/admin/upload', { method: 'POST', body: form })
    const data = await response.json().catch(() => ({}))
    setUploading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo subir la imagen'); return }
    setImageUrl(data.url)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/admin/campaigns', {
      method: campaign ? 'PATCH' : 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ campaignId:campaign?.id, name:form.get('name'), channel, content:form.get('content'), subject:channel==='EMAIL'?(subject||null):null, emailHtml:channel==='EMAIL'?(emailHtml||null):null, imageUrl:imageUrl||null, audience:{segment}, scheduledAt:form.get('scheduledAt')||null }),
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

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <form onSubmit={submit} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">{campaign?'Editar campaña':'Nueva campaña'}</h2><p className="text-sm text-[#736f83]">Solo se enviará a clientes con consentimiento vigente.</p></div>
        <button aria-label="Cerrar" type="button" onClick={onClose}><X/></button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Nombre<input name="name" required defaultValue={campaign?.name??''} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Canal<select name="channel" value={channel} onChange={e=>setChannel(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="INSTAGRAM">Instagram</option><option value="MESSENGER">Messenger</option><option value="PUSH">Notificación</option></select></label>
        <label className="text-sm font-semibold">Segmento<select name="segment" value={segment} onChange={e=>setSegment(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="ALL">Todos con consentimiento</option><option value="ACTIVE">Clientes activos</option><option value="INACTIVE">Clientes inactivos</option><option value="BIRTHDAY">Cumpleaños del mes</option></select></label>
        <label className="text-sm font-semibold">Programar<input name="scheduledAt" type="datetime-local" defaultValue={scheduled} className="mt-2 w-full rounded-xl border p-3"/></label>
      </div>

      <p className="mt-3 rounded-xl bg-[#f7f6fa] p-3 text-sm font-semibold text-[#4b4761]">{audience === null ? 'Calculando a cuánta gente llega…' : audience === 0 ? 'Ahora mismo no hay nadie con permiso vigente para este canal.' : `Se enviará a ${audience} ${audience === 1 ? 'persona' : 'personas'}.`}</p>

      <div className="mt-4 rounded-xl border border-dashed p-3">
        <p className="flex items-center gap-2 text-xs font-bold text-[#5b3df5]"><Sparkles size={14}/>Generar con IA</p>
        <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={2} placeholder="Ej: 20% de descuento en manicure los martes de agosto" className="mt-2 w-full rounded-lg border p-2 text-sm"/>
        <button type="button" onClick={generate} disabled={generating||!description.trim()} className="mt-2 rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-[#5b3df5] disabled:opacity-40">{generating?'Redactando…':'Redactar texto'}</button>
      </div>

      <label className="mt-4 block text-sm font-semibold">Mensaje<textarea name="content" required maxLength={1500} rows={5} value={content} onChange={e=>setContent(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/></label>

      {channel === 'EMAIL' && <div className="mt-4 rounded-xl border p-3">
        <label className="block text-sm font-semibold">Asunto del correo<input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={120} placeholder="Lo primero que ve el cliente en su bandeja" className="mt-2 w-full rounded-xl border p-3"/></label>
        <p className="mt-1 text-xs text-[#736f83]">Si lo dejas vacío se usa el nombre de la campaña.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={designEmail} disabled={designing||!content.trim()} className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-[#5b3df5] disabled:opacity-40">{designing?'Diseñando…':'Diseñar correo con IA'}</button>
          {emailHtml && <button type="button" onClick={()=>setEmailHtml('')} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Volver al correo simple</button>}
        </div>
        {emailHtml && <p className="mt-2 text-xs text-emerald-700">Diseño listo: se enviará este correo en vez de la plantilla simple.</p>}
      </div>}

      <div className="mt-4">
        <p className="text-sm font-semibold">Imagen (opcional)</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold"><ImagePlus size={16}/>{uploading ? 'Subiendo…' : 'Subir imagen'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="hidden"/></label>
          {imageUrl && <button type="button" onClick={() => setImageUrl('')} className="rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-700">Quitar</button>}
        </div>
        <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="…o pega una dirección https://" className="mt-2 w-full rounded-xl border p-3 text-sm"/>
        <p className="mt-1 text-xs text-[#736f83]">JPG, PNG o WEBP, hasta 5 MB.</p>
      </div>

      <div className="mt-5 rounded-2xl border border-black/5 bg-[#f7f6fa] p-4">
        <p className="text-xs font-bold uppercase text-[#736f83]">Vista previa</p>
        <div className="mt-2 rounded-2xl bg-white p-3 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {imageUrl && !emailHtml && <img src={imageUrl} alt="Imagen de la campaña" className="mb-2 max-h-40 w-full rounded-xl object-cover"/>}
          {emailHtml
            ? <iframe title="Vista previa del correo" srcDoc={emailHtml} sandbox="" className="h-72 w-full rounded-xl border-0 bg-white"/>
            : <p className="whitespace-pre-line text-sm leading-6">{content || 'Aquí se verá el mensaje tal como le llega al cliente.'}</p>}
          {channel === 'EMAIL' && <p className="mt-3 border-t border-black/5 pt-2 text-[11px] text-[#9a96a5]">Se agrega automáticamente el enlace para dejar de recibir promociones.</p>}
        </div>
      </div>

      {error&&<p className="mt-3 text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading?'Guardando…':campaign?'Guardar cambios':'Crear campaña'}</button>
    </form>
  </div>
}
