'use client'

import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'

/** Borrado definitivo: obliga a escribir una palabra para habilitar el botón, para que nadie borre de un clic distraído. */
export function ConfirmDeleteModal({ title, description, detail, word = 'ELIMINAR', onCancel, onConfirm }: {
  title: string
  description: string
  detail?: string
  word?: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [working, setWorking] = useState(false)
  const ready = typed.trim().toUpperCase() === word.toUpperCase()

  async function confirm() {
    if (!ready || working) return
    setWorking(true)
    await onConfirm()
    setWorking(false)
  }

  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
    <div role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-600"><AlertTriangle size={20}/></span>
          <div>
            <h2 className="text-lg font-black">{title}</h2>
            <p className="mt-1 text-sm text-[#736f83]">{description}</p>
          </div>
        </div>
        <button type="button" aria-label="Cancelar" onClick={onCancel}><X/></button>
      </div>

      {detail && <p className="mt-4 rounded-xl bg-[#f7f6fa] p-3 text-sm font-semibold text-[#4b4761]">{detail}</p>}

      <p className="mt-4 text-sm">Esto no se puede deshacer. Para confirmar, escribe <b>{word}</b>:</p>
      <input
        autoFocus
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }}
        placeholder={word}
        className="mt-2 w-full rounded-xl border p-3 uppercase tracking-wide"
      />

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl border py-3 font-bold">Cancelar</button>
        <button type="button" disabled={!ready || working} onClick={() => void confirm()} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-40">{working ? 'Eliminando…' : 'Eliminar'}</button>
      </div>
    </div>
  </div>
}
