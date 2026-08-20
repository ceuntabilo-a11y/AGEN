'use client'

import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { ImagePlus, Sparkles } from 'lucide-react'
import { ModalShell } from '@/components/ModalShell'

type AudienceDraft = { segment?:string; q?:string; visitedWithinDays?:number; daysSinceLastVisitMin?:number; daysSinceLastVisitMax?:number; visitCountMin?:number; visitCountMax?:number; visitCountWindowDays?:number }
type CampaignDraft = { id:string; name:string; channel:string; content:string; subject?:string|null; email_html?:string|null; audience?:AudienceDraft; scheduled_at?:string|null; image_url?:string|null }

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

  // Filtros de CRM sobre la audiencia: buscar por nombre y acotar por su historial de visitas.
  const [search,setSearch] = useState(campaign?.audience?.q??'')
  const [visitedWithinDays,setVisitedWithinDays] = useState(campaign?.audience?.visitedWithinDays?.toString()??'')
  const [daysSinceMin,setDaysSinceMin] = useState(campaign?.audience?.daysSinceLastVisitMin?.toString()??'')
  const [daysSinceMax,setDaysSinceMax] = useState(campaign?.audience?.daysSinceLastVisitMax?.toString()??'')
  const [visitCountMin,setVisitCountMin] = useState(campaign?.audience?.visitCountMin?.toString()??'')
  const [visitCountMax,setVisitCountMax] = useState(campaign?.audience?.visitCountMax?.toString()??'')
  const [visitCountWindow,setVisitCountWindow] = useState(campaign?.audience?.visitCountWindowDays?.toString()??'')

  // Cuánta gente recibiría esto ahora mismo, contando solo consentimientos vigentes.
  useEffect(() => {
    let active = true
    setAudience(null)
    const params = new URLSearchParams({ channel, segment })
    if (search.trim()) params.set('q', search.trim())
    if (visitedWithinDays) params.set('visitedWithinDays', visitedWithinDays)
    if (daysSinceMin) params.set('daysSinceLastVisitMin', daysSinceMin)
    if (daysSinceMax) params.set('daysSinceLastVisitMax', daysSinceMax)
    if (visitCountMin) params.set('visitCountMin', visitCountMin)
    if (visitCountMax) params.set('visitCountMax', visitCountMax)
    if (visitCountWindow) params.set('visitCountWindowDays', visitCountWindow)
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/campaigns/audience?${params.toString()}`, { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => { if (active && data) setAudience(data.count) })
        .catch(() => undefined)
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [channel, segment, search, visitedWithinDays, daysSinceMin, daysSinceMax, visitCountMin, visitCountMax, visitCountWindow])

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
    const conCorreo = channel==='EMAIL'||channel==='BOTH'
    const audienceFilters: Record<string,unknown> = { segment }
    if (search.trim()) audienceFilters.q = search.trim()
    if (visitedWithinDays) audienceFilters.visitedWithinDays = Number(visitedWithinDays)
    if (daysSinceMin) audienceFilters.daysSinceLastVisitMin = Number(daysSinceMin)
    if (daysSinceMax) audienceFilters.daysSinceLastVisitMax = Number(daysSinceMax)
    if (visitCountMin) audienceFilters.visitCountMin = Number(visitCountMin)
    if (visitCountMax) audienceFilters.visitCountMax = Number(visitCountMax)
    if (visitCountWindow) audienceFilters.visitCountWindowDays = Number(visitCountWindow)
    const response = await fetch('/api/admin/campaigns', {
      method: campaign ? 'PATCH' : 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ campaignId:campaign?.id, name:form.get('name'), channel, content:form.get('content'), subject:conCorreo?(subject||null):null, emailHtml:conCorreo?(emailHtml||null):null, imageUrl:imageUrl||null, audience:audienceFilters, scheduledAt:form.get('scheduledAt')||null }),
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

  return <ModalShell titulo={campaign?'Editar campaña':'Nueva campaña'} onClose={onClose}>
    <form onSubmit={submit} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">{campaign?'Editar campaña':'Nueva campaña'}</h2><p className="text-sm text-[#736f83]">Solo se enviará a clientes con consentimiento vigente.</p></div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Nombre<input name="name" required defaultValue={campaign?.name??''} className="mt-2 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Canal<select name="channel" value={channel} onChange={e=>setChannel(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="BOTH">WhatsApp y Email a la vez</option><option value="INSTAGRAM">Instagram</option><option value="MESSENGER">Messenger</option><option value="PUSH">Notificación</option></select></label>
        <label className="text-sm font-semibold">Segmento<select name="segment" value={segment} onChange={e=>setSegment(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="ALL">Todos con consentimiento</option><option value="ACTIVE">Clientes activos</option><option value="INACTIVE">Clientes inactivos</option><option value="BIRTHDAY">Cumpleaños del mes</option></select></label>
        <label className="text-sm font-semibold">Programar<input name="scheduledAt" type="datetime-local" defaultValue={scheduled} className="mt-2 w-full rounded-xl border p-3"/></label>
      </div>

      <div className="mt-4 rounded-xl border p-3">
        <p className="text-xs font-bold uppercase text-[#736f83]">Filtros de la audiencia</p>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nombre…" className="mt-2 w-full rounded-lg border p-2 text-sm"/>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-[#4b4761]">Asistió en los últimos días
            <select value={visitedWithinDays} onChange={e=>setVisitedWithinDays(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm">
              <option value="">Cualquier momento</option>
              <option value="7">7 días</option>
              <option value="15">15 días</option>
              <option value="30">30 días</option>
            </select>
          </label>
          <div className="text-xs font-semibold text-[#4b4761]">Días desde la última visita
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min={0} value={daysSinceMin} onChange={e=>setDaysSinceMin(e.target.value)} placeholder="mín" className="w-full rounded-lg border p-2 text-sm"/>
              <span className="text-[#9a96a5]">a</span>
              <input type="number" min={0} value={daysSinceMax} onChange={e=>setDaysSinceMax(e.target.value)} placeholder="máx" className="w-full rounded-lg border p-2 text-sm"/>
            </div>
          </div>
          <div className="text-xs font-semibold text-[#4b4761] sm:col-span-2">Cuántas veces ha venido
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min={0} value={visitCountMin} onChange={e=>setVisitCountMin(e.target.value)} placeholder="mín" className="w-24 rounded-lg border p-2 text-sm"/>
              <span className="text-[#9a96a5]">a</span>
              <input type="number" min={0} value={visitCountMax} onChange={e=>setVisitCountMax(e.target.value)} placeholder="máx" className="w-24 rounded-lg border p-2 text-sm"/>
              <span className="text-[#9a96a5]">veces en los últimos</span>
              <input type="number" min={0} value={visitCountWindow} onChange={e=>setVisitCountWindow(e.target.value)} placeholder="días (vacío = siempre)" className="w-40 rounded-lg border p-2 text-sm"/>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 rounded-xl bg-[#f7f6fa] p-3 text-sm font-semibold text-[#4b4761]">{audience === null ? 'Calculando a cuánta gente llega…' : audience === 0 ? 'Ahora mismo no hay nadie con permiso vigente que cumpla estos filtros.' : `Se enviará a ${audience} ${audience === 1 ? 'persona' : 'personas'}.`}</p>

      <div className="mt-4 rounded-xl border border-dashed p-3">
        <p className="flex items-center gap-2 text-xs font-bold text-[#5b3df5]"><Sparkles size={14}/>Generar con IA</p>
        <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={2} placeholder="Ej: 20% de descuento en manicure los martes de agosto" className="mt-2 w-full rounded-lg border p-2 text-sm"/>
        <button type="button" onClick={generate} disabled={generating||!description.trim()} className="mt-2 rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-[#5b3df5] disabled:opacity-40">{generating?'Redactando…':'Redactar texto'}</button>
      </div>

      <label className="mt-4 block text-sm font-semibold">Mensaje<textarea name="content" required maxLength={1500} rows={5} value={content} onChange={e=>setContent(e.target.value)} className="mt-2 w-full rounded-xl border p-3"/></label>

      {(channel === 'EMAIL' || channel === 'BOTH') && <div className="mt-4 rounded-xl border p-3">
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
          {(channel === 'EMAIL' || channel === 'BOTH') && <p className="mt-3 border-t border-black/5 pt-2 text-[11px] text-[#9a96a5]">Se agrega automáticamente el enlace para dejar de recibir promociones.</p>}
        </div>
      </div>

      {error&&<p className="mt-3 text-sm text-red-600">{error}</p>}
      <button disabled={loading} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading?'Guardando…':campaign?'Guardar cambios':'Crear campaña'}</button>
    </form>
  </ModalShell>
}
