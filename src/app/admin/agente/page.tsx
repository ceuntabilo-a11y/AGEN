'use client'
import { PageHeader } from '@/components/PageHeader'
import { Bot } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'

type AgentSettings = {
  enabled?: boolean; tone?: string; human_handoff_enabled?: boolean; prompt_extra?: string
  voice?: { enabled?: boolean; gender?: string; style?: string; speed?: number; accent?: string; emotion?: string; language?: string }
  behavior?: { respond_voice?: boolean; respond_voice_only_if_voice?: boolean; also_send_text?: boolean; max_duration_seconds?: number }
}
type Business = { agent_settings: AgentSettings }

const TABS = ['General', 'Personalidad', 'Voz', 'Comportamiento', 'Prompt'] as const

export default function AgentPage() {
  const [business, setBusiness] = useState<Business | null>(null)
  const [tab, setTab] = useState<typeof TABS[number]>('General')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => { fetch('/api/admin/settings').then(r => r.ok ? r.json() : Promise.reject()).then(d => setBusiness(d.business)).catch(() => setError('Conecta Supabase para configurar el agente.')) }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaved(false); setError('')
    const form = new FormData(event.currentTarget)
    const agent_settings: AgentSettings = {
      enabled: form.get('enabled') === 'on',
      tone: String(form.get('tone') || 'friendly'),
      human_handoff_enabled: form.get('handoff') === 'on',
      prompt_extra: String(form.get('promptExtra') || ''),
      voice: {
        enabled: form.get('voiceEnabled') === 'on',
        gender: String(form.get('gender') || 'female'),
        style: String(form.get('style') || 'warm'),
        speed: Number(form.get('speed') || 1),
        accent: String(form.get('accent') || 'neutral'),
        emotion: String(form.get('emotion') || 'neutral'),
        language: String(form.get('language') || 'es'),
      },
      behavior: {
        respond_voice: form.get('respondVoice') === 'on',
        respond_voice_only_if_voice: form.get('respondVoiceOnlyIfVoice') === 'on',
        also_send_text: form.get('alsoSendText') === 'on',
        max_duration_seconds: Number(form.get('maxDuration') || 30),
      },
    }
    const response = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent_settings }) })
    const data = await response.json()
    if (response.ok) { setSaved(true); setBusiness(data.business) } else setError(data.error ?? 'No se pudo guardar')
  }

  async function testVoice() {
    setPreviewLoading(true); setPreviewError('')
    const response = await fetch('/api/admin/agent/voice-preview', { method: 'POST' })
    if (!response.ok) { const data = await response.json().catch(() => ({})); setPreviewError(data.error ?? 'No se pudo generar la voz'); setPreviewLoading(false); return }
    const data = await response.json() as { audio: string; mime: string }
    if (!data.audio) { setPreviewError('El proveedor de voz no devolvió audio'); setPreviewLoading(false); return }
    const audio = new Audio(`data:${data.mime || 'audio/wav'};base64,${data.audio}`)
    audio.play().catch((playError) => setPreviewError(`No se pudo reproducir el audio: ${playError instanceof Error ? `${playError.name} — ${playError.message}` : String(playError)}`))
    setPreviewLoading(false)
  }

  if (!business) return <>{error && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}</>
  const settings = business.agent_settings ?? {}
  const voice = settings.voice ?? {}
  const behavior = settings.behavior ?? {}

  return <>
    <PageHeader title="Agente IA" description="Identidad, personalidad, voz y comportamiento del agente." action={<span className={`rounded-full px-4 py-2 text-sm font-bold ${settings.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f1eff9] text-[#736f83]'}`}>{settings.enabled ? '● Activo' : '○ Apagado'}</span>} />
    <div className="mb-5 flex flex-wrap gap-2">{TABS.map(name => <button key={name} onClick={() => setTab(name)} className={`rounded-xl border px-4 py-2 text-sm font-bold ${tab === name ? 'border-[#5b3df5] bg-violet-50 text-[#5b3df5]' : ''}`}>{name}</button>)}</div>
    {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <form onSubmit={submit} className="rounded-2xl border bg-white p-6">
      {tab === 'General' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} />Agente habilitado</label>
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input name="handoff" type="checkbox" defaultChecked={settings.human_handoff_enabled} />Permitir transferir a una persona</label>
      </div>}
      {tab === 'Personalidad' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">Tono<select name="tone" defaultValue={settings.tone ?? 'friendly'} className="mt-2 w-full rounded-xl border p-3"><option value="friendly">Cercano</option><option value="professional">Profesional</option><option value="brief">Breve</option></select></label>
      </div>}
      {tab === 'Voz' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input name="voiceEnabled" type="checkbox" defaultChecked={voice.enabled} />Habilitar respuestas por voz</label>
        <label className="text-sm font-semibold">Género<select name="gender" defaultValue={voice.gender ?? 'female'} className="mt-2 w-full rounded-xl border p-3"><option value="female">Mujer</option><option value="male">Hombre</option></select></label>
        <label className="text-sm font-semibold">Estilo<select name="style" defaultValue={voice.style ?? 'warm'} className="mt-2 w-full rounded-xl border p-3"><option value="warm">Cálido</option><option value="professional">Profesional</option><option value="energetic">Energético</option></select></label>
        <label className="text-sm font-semibold">Velocidad<input name="speed" type="number" step="0.1" min="0.5" max="2" defaultValue={voice.speed ?? 1} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Acento<input name="accent" defaultValue={voice.accent ?? 'neutral'} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Emoción<input name="emotion" defaultValue={voice.emotion ?? 'neutral'} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Idioma<input name="language" defaultValue={voice.language ?? 'es'} className="mt-2 w-full rounded-xl border p-3" /></label>
        <div className="sm:col-span-2"><button type="button" onClick={testVoice} disabled={previewLoading} className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50">{previewLoading ? 'Generando…' : 'Probar voz'}</button>{previewError && <p className="mt-2 text-sm text-red-600">{previewError}</p>}<p className="mt-2 text-xs text-[#736f83]">Guarda cambios antes de probar — usa la configuración ya guardada.</p></div>
      </div>}
      {tab === 'Comportamiento' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="respondVoice" type="checkbox" defaultChecked={behavior.respond_voice} />Responder con voz</label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="respondVoiceOnlyIfVoice" type="checkbox" defaultChecked={behavior.respond_voice_only_if_voice ?? true} />Solo si el cliente escribió por voz</label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="alsoSendText" type="checkbox" defaultChecked={behavior.also_send_text ?? true} />Enviar también el texto</label>
        <label className="text-sm font-semibold">Duración máxima (segundos)<input name="maxDuration" type="number" min="5" max="120" defaultValue={behavior.max_duration_seconds ?? 30} className="mt-2 w-full rounded-xl border p-3" /></label>
      </div>}
      {tab === 'Prompt' && <div><label className="text-sm font-semibold">Instrucciones adicionales para el agente<textarea name="promptExtra" rows={6} maxLength={2000} defaultValue={settings.prompt_extra ?? ''} placeholder="Ej: menciona siempre nuestra promoción de martes de descuento." className="mt-2 w-full rounded-xl border p-3" /></label><p className="mt-2 text-xs text-[#736f83]">Se suma a las reglas protegidas del agente (nunca las reemplaza).</p></div>}
      <button className="mt-6 rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white">Guardar configuración</button>
      {saved && <p className="mt-3 text-sm font-bold text-emerald-600">Configuración guardada.</p>}
    </form>
    <article className="mt-6 rounded-2xl bg-[#19162b] p-6 text-white"><Bot size={28} className="text-violet-400" /><h2 className="mt-4 text-lg font-extrabold">Reglas protegidas (no editables)</h2><ul className="mt-3 space-y-2 text-sm text-white/75"><li>· Solo muestra profesionales habilitados para el servicio</li><li>· Consulta disponibilidad antes de ofrecer una hora</li><li>· Revalida dentro de la transacción al reservar</li><li>· El modo equipo es siempre de solo lectura</li></ul></article>
  </>
}
