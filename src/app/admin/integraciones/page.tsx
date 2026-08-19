'use client'
import { PageHeader } from '@/components/PageHeader'
import { WhatsAppConnect } from '@/components/WhatsAppConnect'
import { FormEvent, useEffect, useState } from 'react'

type Integrations = { whatsapp_provider: string | null; whatsapp_instance: string | null; whatsapp_phone_id: string | null; whatsapp_token: string | null; whatsapp_360_api_key: string | null; openai_api_key: string | null; dashscope_api_key: string | null; dashscope_endpoint: string | null; feature_image: boolean; feature_voice: boolean; resend_configured: boolean; google_review_url: string | null }

export default function IntegrationsPage() {
  const [data, setData] = useState<Integrations | null>(null)
  const [provider, setProvider] = useState('EVOLUTION')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetch('/api/admin/integrations').then(r => r.ok ? r.json() : Promise.reject()).then(d => { setData(d.integrations); setProvider(d.integrations.whatsapp_provider || 'EVOLUTION') }).catch(() => setError('Conecta Supabase para ver integraciones.')) }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaved(false); setError('')
    const form = new FormData(event.currentTarget)
    const body: Record<string, unknown> = { whatsapp_provider: provider, feature_image: form.get('featureImage') === 'on', feature_voice: form.get('featureVoice') === 'on' }
    if (provider === 'META') { body.whatsapp_phone_id = form.get('phoneId'); body.whatsapp_token = form.get('metaToken') }
    if (provider === 'DIALOG360') body.whatsapp_360_api_key = form.get('dialog360Key')
    if (form.get('openaiKey')) body.openai_api_key = form.get('openaiKey')
    if (form.get('dashscopeKey')) body.dashscope_api_key = form.get('dashscopeKey')
    if (form.get('dashscopeEndpoint') !== undefined) body.dashscope_endpoint = form.get('dashscopeEndpoint') || null
    body.google_review_url = String(form.get('googleReviewUrl') ?? '').trim() || null
    const response = await fetch('/api/admin/integrations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json()
    if (response.ok) { setSaved(true); setData(previous => previous ? { ...previous, ...result.integrations } : previous) } else setError(result.error ?? 'No se pudo guardar')
  }

  if (!data) return <>{error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}</>

  return <>
    <PageHeader title="Integraciones" description="Conecta WhatsApp, tu clave de IA y las capacidades del agente." />
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border bg-white p-5 lg:col-span-2">
        <h2 className="font-extrabold">WhatsApp</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {[['EVOLUTION', 'QR rápido (Evolution)'], ['META', 'Meta API oficial'], ['DIALOG360', '360dialog']].map(([value, label]) => <button type="button" key={value} onClick={() => setProvider(value)} className={`rounded-xl border px-4 py-2 text-sm font-bold ${provider === value ? 'border-[#5b3df5] bg-violet-50 text-[#5b3df5]' : ''}`}>{label}</button>)}
        </div>
        {provider === 'EVOLUTION' && <div className="mt-5"><WhatsAppConnect onConnected={() => setSaved(true)} /></div>}
        {provider === 'META' && <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Phone number ID<input name="phoneId" defaultValue={data.whatsapp_phone_id ?? ''} className="mt-2 w-full rounded-xl border p-3" /></label><label className="text-sm font-semibold">Token de acceso<input name="metaToken" type="password" placeholder={data.whatsapp_token ? '••••••••' : 'EAAG...'} className="mt-2 w-full rounded-xl border p-3" /></label></div>}
        {provider === 'DIALOG360' && <div className="mt-5"><label className="text-sm font-semibold">API key de 360dialog<input name="dialog360Key" type="password" placeholder={data.whatsapp_360_api_key ? '••••••••' : ''} className="mt-2 w-full rounded-xl border p-3" /></label><p className="mt-2 text-xs text-amber-700">Aviso: este proveedor no está verificado con envío real todavía — pruébalo antes de depender de él en producción.</p></div>}
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-extrabold">Tu IA (OpenAI)</h2>
        <label className="mt-4 block text-sm font-semibold">Clave de API<input name="openaiKey" type="password" autoComplete="off" data-lpignore="true" data-1p-ignore="true" placeholder={data.openai_api_key ? '••••••••' : 'sk-...'} className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" /></label>
        <p className="mt-2 text-xs text-[#736f83]">Sin clave propia, el copiloto y el agente usan la clave de respaldo de la plataforma si está configurada.</p>
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-extrabold">Reseñas en Google</h2>
        <label className="mt-4 block text-sm font-semibold">Enlace para dejar reseña<input name="googleReviewUrl" type="url" placeholder="https://g.page/r/..." defaultValue={data.google_review_url ?? ''} className="mt-2 w-full rounded-xl border p-3" /></label>
        <p className="mt-2 text-xs text-[#736f83]">El agente se lo manda solo a quien puntúa 9 o 10 en la encuesta. Vacío = solo agradece, sin pedir reseña.</p>
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-extrabold">Correo de marketing (Resend)</h2>
        {data.resend_configured
          ? <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />Activo — tus campañas por email ya pueden enviarse.</p>
          : <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" />Sin configurar — el dueño de la plataforma debe cargar la clave de Resend en Plataforma → Claves antes de que puedas enviar campañas por email.</p>}
        <p className="mt-2 text-xs text-[#736f83]">Es una clave compartida por toda la plataforma, no se configura por negocio. Tus campañas salen con el nombre de tu negocio y responden a tu correo de contacto.</p>
      </section>
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-extrabold">Capacidades del agente</h2>
        <label className="mt-4 flex items-center gap-2 text-sm"><input name="featureImage" type="checkbox" defaultChecked={data.feature_image} />Analizar imágenes que envíen los clientes</label>
        <label className="mt-2 flex items-center gap-2 text-sm"><input name="featureVoice" type="checkbox" defaultChecked={data.feature_voice} />Transcribir y responder notas de voz</label>
        <label className="mt-4 block text-sm font-semibold">Clave de voz (DashScope/Qwen)<input name="dashscopeKey" type="password" autoComplete="off" data-lpignore="true" data-1p-ignore="true" placeholder={data.dashscope_api_key ? '••••••••' : 'sk-...'} className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" /></label>
        <label className="mt-3 block text-sm font-semibold">Endpoint dedicado (solo si tu clave es sk-ws-...)<input name="dashscopeEndpoint" defaultValue={data.dashscope_endpoint ?? ''} className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" /></label>
      </section>
      <button className="rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white lg:col-span-2">Guardar integraciones</button>
      {saved && <p className="text-sm font-bold text-emerald-600 lg:col-span-2">Guardado.</p>}
    </form>
  </>
}
