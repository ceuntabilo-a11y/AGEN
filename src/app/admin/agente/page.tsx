'use client'
import { ModalShell } from '@/components/ModalShell'
import { PageHeader } from '@/components/PageHeader'
import { mensajeDeFallo } from '@/lib/api-fetch-error'
import { Bot } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'

type AgentSettings = {
  enabled?: boolean; tone?: string; human_handoff_enabled?: boolean; handoff_phone?: string | null
  voice?: { enabled?: boolean; gender?: string; style?: string; speed?: number; accent?: string; emotion?: string; language?: string }
  behavior?: { respond_voice?: boolean; respond_voice_only_if_voice?: boolean; also_send_text?: boolean; max_duration_seconds?: number }
}
type Business = { name?: string; agent_settings: AgentSettings }

/*
 * La pestaña «Prompt» ya no existe.
 *
 * Dejaba que el negocio escribiera instrucciones sueltas que se sumaban a las del agente, y eso
 * es exactamente cómo se contradice a sí mismo («di siempre el precio» contra «el precio solo si
 * lo piden»). Además, en la práctica no lo leía nadie: se guardaba y ahí se quedaba. Lo que el
 * agente dice se construye ahora con lo que hay en Configuración —servicios, horarios,
 * profesionales, tono— y eso no admite contradicción.
 */
const TABS = ['General', 'Personalidad', 'Voz', 'Comportamiento'] as const

export default function AgentPage() {
  const [business, setBusiness] = useState<Business | null>(null)
  const [tab, setTab] = useState<typeof TABS[number]>('General')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [handoffEnabled, setHandoffEnabled] = useState(false)
  const [handoffPhone, setHandoffPhone] = useState('')
  const [phoneModal, setPhoneModal] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewText, setPreviewText] = useState('Hola, soy el asistente virtual. ¿En qué puedo ayudarte hoy?')

  useEffect(() => {
    fetch('/api/admin/settings').then(r => {
      if (!r.ok) { setError(mensajeDeFallo(r.status, 'configurar el agente')); return null }
      return r.json()
    })
      .then(d => {
        if (!d) return
        setBusiness(d.business)
        setHandoffEnabled(d.business?.agent_settings?.human_handoff_enabled === true)
        setHandoffPhone(String(d.business?.agent_settings?.handoff_phone ?? ''))
        setError('')
      })
      .catch(() => setError(mensajeDeFallo(null, 'configurar el agente')))
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaved(false); setError(''); setSaving(true)
    const form = new FormData(event.currentTarget)
    const agent_settings: AgentSettings = {
      enabled: form.get('enabled') === 'on',
      tone: String(form.get('tone') || 'friendly'),
      human_handoff_enabled: handoffEnabled,
      handoff_phone: handoffPhone.trim() || null,
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
    setSaving(false)
    if (response.ok) {
      setSaved(true); setBusiness(data.business)
      setTimeout(() => setSaved(false), 4000)
    } else setError(data.error ?? 'No se pudo guardar')
  }

  async function testVoice() {
    if (!previewText.trim()) return
    setPreviewLoading(true); setPreviewError('')
    const response = await fetch('/api/admin/agent/voice-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: previewText.trim() }) })
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
  const telefonoVisible = handoffPhone.trim()

  return <>
    <PageHeader title="Agente IA" description="Identidad, personalidad, voz y comportamiento del agente." action={<span className={`rounded-full px-4 py-2 text-sm font-bold ${settings.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f1eff9] text-[#736f83]'}`}>{settings.enabled ? '● Activo' : '○ Apagado'}</span>} />
    <div className="mb-5 flex flex-wrap gap-2">{TABS.map(name => <button key={name} type="button" onClick={() => setTab(name)} className={`rounded-xl border px-4 py-2 text-sm font-bold ${tab === name ? 'border-[#5b3df5] bg-violet-50 text-[#5b3df5]' : ''}`}>{name}</button>)}</div>
    {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <form onSubmit={submit} className="rounded-2xl border bg-white p-6">
      {tab === 'General' && <div className="grid gap-5">
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="enabled" type="checkbox" defaultChecked={settings.enabled} />Agente habilitado</label>
        <p className="-mt-3 text-xs text-[#736f83]">Si lo apagas, el agente deja de responder a los clientes por WhatsApp al instante. Los mensajes siguen llegando al panel para que los atienda tu equipo.</p>

        <div className="rounded-2xl border p-4">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={handoffEnabled} onChange={(evento) => setHandoffEnabled(evento.target.checked)} />
            Permitir transferir a una persona
          </label>

          <div className="mt-3 rounded-xl bg-[#f8f7fc] p-3 text-xs leading-relaxed text-[#4a4560]">
            <b>Qué hace:</b> cuando el agente no puede resolver algo —un pago, un reclamo, un tema
            delicado, o el cliente pide hablar con alguien— le manda un WhatsApp a la persona que
            indiques aquí.
            <br /><br />
            <b>Qué le llega:</b> el nombre y el teléfono del cliente, el motivo por el que se
            transfiere y lo que el cliente escribió, para que pueda atenderlo sin volver a
            preguntarle nada.
            <br /><br />
            <b>Un número por negocio.</b> Se guarda aquí mismo y el agente lo usa solo.
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {telefonoVisible
              ? <><span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">Avisos a: {telefonoVisible}</span>
                <button type="button" onClick={() => { setPhoneDraft(telefonoVisible); setPhoneModal(true) }} className="rounded-xl border px-4 py-2 text-sm font-bold">Cambiar número</button></>
              : <><span className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">Sin número configurado</span>
                <button type="button" onClick={() => { setPhoneDraft(''); setPhoneModal(true) }} className="rounded-xl bg-[#5b3df5] px-4 py-2 text-sm font-bold text-white">Configurar número</button></>}
          </div>
          {handoffEnabled && !telefonoVisible && <p className="mt-2 text-xs font-semibold text-amber-700">Sin un número, el aviso solo queda en el panel: nadie recibe nada en su teléfono.</p>}
        </div>
      </div>}

      {tab === 'Personalidad' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold sm:col-span-2">Tono
          <select name="tone" defaultValue={settings.tone ?? 'friendly'} className="mt-2 w-full rounded-xl border p-3">
            <option value="friendly">Cercano — cálido y cotidiano, con algún emoji</option>
            <option value="professional">Profesional — sobrio y correcto, sin emojis</option>
            <option value="brief">Breve — al grano, máximo 3 líneas</option>
          </select>
          <small className="mt-1 block font-normal text-[#736f83]">Cambia de verdad cómo escribe el agente en cada mensaje.</small>
        </label>
      </div>}

      {tab === 'Voz' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold sm:col-span-2"><input name="voiceEnabled" type="checkbox" defaultChecked={voice.enabled} />Habilitar respuestas por voz</label>
        <label className="text-sm font-semibold">Género<select name="gender" defaultValue={voice.gender ?? 'female'} className="mt-2 w-full rounded-xl border p-3"><option value="female">Mujer</option><option value="male">Hombre</option></select></label>
        <label className="text-sm font-semibold">Estilo<select name="style" defaultValue={voice.style ?? 'warm'} className="mt-2 w-full rounded-xl border p-3"><option value="warm">Cálido</option><option value="professional">Profesional</option><option value="energetic">Energético</option></select></label>
        <label className="text-sm font-semibold">Velocidad<input name="speed" type="number" step="0.1" min="0.5" max="2" defaultValue={voice.speed ?? 1} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Acento<input name="accent" defaultValue={voice.accent ?? 'neutral'} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Emoción<input name="emotion" defaultValue={voice.emotion ?? 'neutral'} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="text-sm font-semibold">Idioma<input name="language" defaultValue={voice.language ?? 'es'} className="mt-2 w-full rounded-xl border p-3" /></label>
        <label className="sm:col-span-2 text-sm font-semibold">Texto de prueba<textarea value={previewText} onChange={(event) => setPreviewText(event.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-xl border p-3 text-sm" placeholder="Escribe lo que quieres escuchar…" /></label>
        <div className="sm:col-span-2"><button type="button" onClick={testVoice} disabled={previewLoading || !previewText.trim()} className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50">{previewLoading ? 'Generando…' : 'Probar voz'}</button>{previewError && <p className="mt-2 text-sm text-red-600">{previewError}</p>}<p className="mt-2 text-xs text-[#736f83]">Guarda cambios antes de probar — usa la configuración ya guardada.</p></div>
      </div>}

      {tab === 'Comportamiento' && <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="respondVoice" type="checkbox" defaultChecked={behavior.respond_voice} />Responder con voz</label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="respondVoiceOnlyIfVoice" type="checkbox" defaultChecked={behavior.respond_voice_only_if_voice ?? true} />Solo si el cliente escribió por voz</label>
        <label className="flex items-center gap-2 text-sm font-semibold"><input name="alsoSendText" type="checkbox" defaultChecked={behavior.also_send_text ?? true} />Enviar también el texto</label>
        <label className="text-sm font-semibold">Duración máxima (segundos)<input name="maxDuration" type="number" min="5" max="120" defaultValue={behavior.max_duration_seconds ?? 30} className="mt-2 w-full rounded-xl border p-3" /></label>
      </div>}

      <button disabled={saving} className="mt-6 rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white disabled:opacity-60">
        {saving ? 'Guardando…' : 'Guardar configuración'}
      </button>
      {saved && <p className="mt-3 text-sm font-bold text-emerald-600" role="status">✓ Configuración guardada y aplicada al agente.</p>}
    </form>

    {phoneModal && <ModalShell titulo="Número para transferir a una persona" onClose={() => setPhoneModal(false)}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6">
        <h2 className="text-lg font-extrabold">Número para transferir a una persona</h2>
        <p className="mt-2 text-sm text-[#736f83]">Aquí llegará el aviso por WhatsApp cuando el agente necesite que atienda alguien del equipo. Escríbelo con el código del país.</p>
        <input
          autoFocus
          value={phoneDraft}
          onChange={(evento) => setPhoneDraft(evento.target.value)}
          placeholder="+56 9 1234 5678"
          className="mt-4 w-full rounded-xl border p-3"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setPhoneModal(false)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancelar</button>
          <button
            type="button"
            onClick={() => { setHandoffPhone(phoneDraft.trim()); setHandoffEnabled(true); setPhoneModal(false) }}
            disabled={phoneDraft.replace(/\D/g, '').length < 8}
            className="rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >Usar este número</button>
        </div>
        <p className="mt-3 text-xs text-[#736f83]">Se guarda cuando pulses «Guardar configuración».</p>
      </div>
    </ModalShell>}

    <article className="mt-6 rounded-2xl bg-[#19162b] p-6 text-white"><Bot size={28} className="text-violet-400" /><h2 className="mt-4 text-lg font-extrabold">Reglas protegidas (no editables)</h2><ul className="mt-3 space-y-2 text-sm text-white/75"><li>· Solo muestra profesionales habilitados para el servicio</li><li>· Consulta disponibilidad antes de ofrecer una hora</li><li>· Revalida dentro de la transacción al reservar</li><li>· El modo equipo es siempre de solo lectura</li><li>· Nunca puede reservar, mover ni cancelar por su cuenta: lo ejecuta el sistema</li></ul></article>
  </>
}
