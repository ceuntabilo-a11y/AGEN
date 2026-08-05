'use client'
import { useEffect, useRef, useState } from 'react'

export function WhatsAppConnect({ onConnected }: { onConnected: () => void }) {
  const [state, setState] = useState<'idle' | 'connecting' | 'open' | 'close'>('idle')
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearInterval(timer.current), [])

  async function poll() {
    const response = await fetch('/api/admin/integrations/whatsapp/status', { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    if (data?.state === 'open') { setState('open'); setQr(null); window.clearInterval(timer.current); onConnected() }
  }

  async function connect() {
    setError(''); setState('connecting')
    const response = await fetch('/api/admin/integrations/whatsapp/connect', { method: 'POST' })
    const data = await response.json()
    if (!response.ok) { setError(data.error ?? 'No se pudo iniciar la conexión'); setState('idle'); return }
    if (data.state === 'open') { setState('open'); onConnected(); return }
    setQr(data.qr)
    timer.current = window.setInterval(poll, 3000)
  }

  async function disconnect() {
    await fetch('/api/admin/integrations/whatsapp/disconnect', { method: 'POST' })
    setState('close'); setQr(null); window.clearInterval(timer.current)
  }

  if (state === 'open') return <div className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">WhatsApp conectado ✓ <button onClick={disconnect} className="ml-3 text-xs font-semibold text-red-600 underline">Desconectar</button></div>
  return <div>
    {!qr && <button onClick={connect} disabled={state === 'connecting'} className="rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{state === 'connecting' ? 'Generando QR…' : 'Conectar WhatsApp'}</button>}
    {qr && <div className="mt-4"><img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="Código QR de WhatsApp" className="h-56 w-56 rounded-xl border" /><p className="mt-2 text-xs text-[#736f83]">Escanea con WhatsApp → Dispositivos vinculados.</p></div>}
    {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
  </div>
}
