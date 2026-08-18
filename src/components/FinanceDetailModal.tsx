'use client'

import { money } from '@/lib/money'
import { formatInZone } from '@/lib/timezone'
import { ESTADO_EN_PALABRAS, numeroDePresupuesto, presupuestoComoHtml, type NegocioDelDocumento, type PresupuestoParaDocumento } from '@/lib/quote-document'
import { useState } from 'react'

/**
 * La ficha de un cobro, un gasto o un presupuesto.
 *
 * Antes las tres listas eran solo eso: filas con un total. Al hacer clic no pasaba nada, así que
 * para ver el detalle de un cobro había que ir a buscarlo a la base de datos. Ahora cada fila se
 * abre y muestra TODO lo que se guardó, con las acciones que corresponden a su estado.
 *
 * El presupuesto además se ve como el documento que recibe el cliente —con el logo y el color
 * del negocio— y se puede imprimir o enviar sin salir de aquí.
 */

export type FichaFinanciera =
  | { tipo: 'cobro'; datos: Record<string, any> }
  | { tipo: 'gasto'; datos: Record<string, any> }
  | { tipo: 'presupuesto'; datos: PresupuestoParaDocumento & Record<string, any> }

type Props = {
  ficha: FichaFinanciera
  negocio: NegocioDelDocumento
  onClose: () => void
  onCambio: () => void
  onEliminar: () => void
}

const METODO: Record<string, string> = {
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', OTHER: 'Otro',
}

export function FinanceDetailModal({ ficha, negocio, onClose, onCambio, onEliminar }: Props) {
  const [trabajando, setTrabajando] = useState('')
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')

  const moneda = negocio.currency || 'CLP'
  const zona = negocio.timezone || 'America/Santiago'
  const fecha = (valor: string | null | undefined) => {
    if (!valor) return '—'
    const completo = /^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T12:00:00Z` : valor
    return formatInZone(completo, zona, { day: 'numeric', month: 'long', year: 'numeric' })
  }

  async function pedir(url: string, options: RequestInit, etiqueta: string, fallback: string) {
    setTrabajando(etiqueta); setError(''); setAviso('')
    const respuesta = await fetch(url, options)
    const cuerpo = await respuesta.json().catch(() => ({})) as { error?: string }
    setTrabajando('')
    if (!respuesta.ok) { setError(cuerpo.error ?? fallback); return false }
    onCambio()
    return true
  }

  const Fila = ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) => (
    <div className="flex justify-between gap-4 border-b border-black/5 py-2 text-sm">
      <span className="text-[#736f83]">{etiqueta}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  )

  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Detalle de ${ficha.tipo}`}>
    <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6">

      {ficha.tipo === 'cobro' && <>
        <h2 className="text-lg font-extrabold">Cobro</h2>
        <p className="mt-1 text-3xl font-extrabold">{money(Number(ficha.datos.amount ?? 0), moneda)}</p>
        <div className="mt-4">
          <Fila etiqueta="Cliente">{ficha.datos.client?.full_name ?? 'Sin cliente'}</Fila>
          {ficha.datos.client?.phone && <Fila etiqueta="Teléfono">{ficha.datos.client.phone}</Fila>}
          {ficha.datos.client?.email && <Fila etiqueta="Correo">{ficha.datos.client.email}</Fila>}
          <Fila etiqueta="Estado">{ficha.datos.status === 'PAID' ? 'Cobrado' : 'Pendiente'}</Fila>
          <Fila etiqueta="Medio de pago">{METODO[String(ficha.datos.method)] ?? ficha.datos.method ?? '—'}</Fila>
          <Fila etiqueta="Registrado">{fecha(ficha.datos.created_at)}</Fila>
          {ficha.datos.paid_at && <Fila etiqueta="Cobrado el">{fecha(ficha.datos.paid_at)}</Fila>}
          {ficha.datos.notes && <Fila etiqueta="Notas">{ficha.datos.notes}</Fila>}
        </div>
        {ficha.datos.status !== 'PAID' && <button
          onClick={() => void pedir('/api/admin/payments', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ficha.datos.id, status: 'PAID' }) }, 'cobrado', 'No se pudo marcar como cobrado')}
          disabled={Boolean(trabajando)}
          className="mt-5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
        >{trabajando === 'cobrado' ? 'Guardando…' : 'Marcar como cobrado'}</button>}
      </>}

      {ficha.tipo === 'gasto' && <>
        <h2 className="text-lg font-extrabold">Gasto</h2>
        <p className="mt-1 text-3xl font-extrabold">{money(Number(ficha.datos.amount ?? 0), moneda)}</p>
        <div className="mt-4">
          <Fila etiqueta="Descripción">{ficha.datos.description}</Fila>
          <Fila etiqueta="Categoría">{ficha.datos.category}</Fila>
          <Fila etiqueta="Fecha">{fecha(ficha.datos.incurred_on)}</Fila>
          {ficha.datos.professional?.display_name && <Fila etiqueta="Profesional">{ficha.datos.professional.display_name}</Fila>}
          {ficha.datos.notes && <Fila etiqueta="Notas">{ficha.datos.notes}</Fila>}
        </div>
      </>}

      {ficha.tipo === 'presupuesto' && <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">Presupuesto {numeroDePresupuesto(String(ficha.datos.id))}</h2>
          <span className="rounded-full bg-[#f1eff9] px-3 py-1 text-xs font-bold text-[#5b3df5]">{ESTADO_EN_PALABRAS[String(ficha.datos.status)] ?? ficha.datos.status}</span>
        </div>

        {/* El documento tal como lo recibe el cliente: mismo generador que el correo. */}
        <div className="mt-4 overflow-auto rounded-xl border" id="documento-presupuesto"
          dangerouslySetInnerHTML={{ __html: presupuestoComoHtml(negocio, ficha.datos) }} />

        <div className="mt-5 flex flex-wrap gap-2">
          {(['WHATSAPP', 'EMAIL', 'BOTH'] as const).map((canal) => (
            <button
              key={canal}
              onClick={async () => {
                const ok = await pedir('/api/admin/quotes/send', {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ id: ficha.datos.id, channel: canal }),
                }, canal, 'No se pudo enviar')
                if (ok) setAviso(canal === 'BOTH' ? 'Enviado por WhatsApp y correo.' : canal === 'EMAIL' ? 'Enviado por correo.' : 'Enviado por WhatsApp.')
              }}
              disabled={Boolean(trabajando)}
              className="rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-60"
            >{trabajando === canal ? 'Enviando…' : canal === 'WHATSAPP' ? 'Enviar por WhatsApp' : canal === 'EMAIL' ? 'Enviar por correo' : 'Enviar por ambos'}</button>
          ))}
          <button type="button" onClick={() => window.print()} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Imprimir o guardar PDF</button>
        </div>

        {!['ACCEPTED', 'REJECTED', 'CONVERTED'].includes(String(ficha.datos.status)) && <div className="mt-3 flex flex-wrap gap-2">
          {([['ACCEPTED', 'Marcar aceptado'], ['REJECTED', 'Marcar rechazado']] as const).map(([estado, etiqueta]) => (
            <button
              key={estado}
              onClick={() => void pedir('/api/admin/quotes', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ficha.datos.id, status: estado }) }, estado, 'No se pudo actualizar')}
              disabled={Boolean(trabajando)}
              className={`rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-60 ${estado === 'ACCEPTED' ? 'bg-emerald-600 text-white' : 'border border-red-200 text-red-700'}`}
            >{trabajando === estado ? 'Guardando…' : etiqueta}</button>
          ))}
        </div>}
      </>}

      {aviso && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700" role="status">{aviso}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="mt-6 flex justify-between gap-2">
        <button onClick={onEliminar} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-700">Eliminar</button>
        <button onClick={onClose} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cerrar</button>
      </div>
    </div>
  </div>
}
