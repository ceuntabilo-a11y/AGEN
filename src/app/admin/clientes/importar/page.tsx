'use client'

import { PageHeader } from '@/components/PageHeader'
import { ArrowLeft, Upload } from 'lucide-react'
import Link from 'next/link'
import { ChangeEvent, useState } from 'react'

type Row = { fullName: string; phone: string; email: string; birthday: string; notes: string }

const FIELDS: Array<[keyof Row, string, string[]]> = [
  ['fullName', 'Nombre', ['nombre', 'cliente', 'name', 'full_name', 'nombre completo', 'paciente']],
  ['phone', 'Teléfono', ['telefono', 'teléfono', 'celular', 'phone', 'movil', 'móvil', 'whatsapp', 'fono']],
  ['email', 'Correo', ['correo', 'email', 'mail', 'e-mail']],
  ['birthday', 'Nacimiento', ['nacimiento', 'cumpleanos', 'cumpleaños', 'birthday', 'fecha de nacimiento']],
  ['notes', 'Notas', ['notas', 'observaciones', 'comentarios', 'notes']],
]

/** Lector de CSV mínimo: respeta comillas y acepta coma o punto y coma como separador. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const separator = (clean.split('\n')[0].match(/;/g)?.length ?? 0) >= (clean.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < clean.length; index++) {
    const character = clean[index]
    if (quoted) {
      if (character === '"' && clean[index + 1] === '"') { value += '"'; index++ }
      else if (character === '"') quoted = false
      else value += character
    } else if (character === '"') quoted = true
    else if (character === separator) { row.push(value); value = '' }
    else if (character === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '' }
    else value += character
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row) }
  return rows.filter((line) => line.some((cell) => cell.trim()))
}

export default function ImportClientsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [raw, setRaw] = useState<string[][]>([])
  const [marketing, setMarketing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: Array<{ row: number; reason: string }> } | null>(null)
  const [loading, setLoading] = useState(false)

  function remap(next: Record<string, number>, data: string[][]) {
    const body = data.slice(1)
    setRows(body.map((line) => ({
      fullName: next.fullName >= 0 ? (line[next.fullName] ?? '').trim() : '',
      phone: next.phone >= 0 ? (line[next.phone] ?? '').trim() : '',
      email: next.email >= 0 ? (line[next.email] ?? '').trim() : '',
      birthday: next.birthday >= 0 ? (line[next.birthday] ?? '').trim() : '',
      notes: next.notes >= 0 ? (line[next.notes] ?? '').trim() : '',
    })))
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(''); setResult(null)
    const text = await file.text()
    const data = parseCsv(text)
    if (data.length < 2) { setError('El archivo no tiene filas de datos.'); return }
    const head = data[0].map((cell) => cell.trim())
    const next: Record<string, number> = {}
    for (const [key, , aliases] of FIELDS) {
      next[key] = head.findIndex((cell) => aliases.includes(cell.toLowerCase().trim()))
    }
    setHeaders(head)
    setRaw(data)
    setMapping(next)
    remap(next, data)
  }

  function changeMapping(field: string, column: number) {
    const next = { ...mapping, [field]: column }
    setMapping(next)
    remap(next, raw)
  }

  async function submit() {
    setLoading(true); setError(''); setResult(null)
    const response = await fetch('/api/admin/clients/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, marketingOptIn: marketing }) })
    const data = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo importar'); return }
    setResult(data)
    setRows([])
  }

  const valid = rows.filter((row) => row.fullName).length

  return <>
    <Link href="/admin/clientes" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#5b3df5]"><ArrowLeft size={16}/>Volver a clientes</Link>
    <PageHeader title="Importar clientes" description="Sube tu planilla y revisa antes de guardar. Nunca se pisa un cliente que ya existe."/>

    <section className="rounded-2xl border border-black/5 bg-white p-5">
      <ol className="mb-5 space-y-1 text-sm text-[#4b4761]">
        <li><b>1.</b> En Excel o Google Sheets, guarda tu planilla como <b>CSV</b>.</li>
        <li><b>2.</b> La primera fila debe tener los títulos de las columnas (por ejemplo: Nombre, Teléfono, Correo).</li>
        <li><b>3.</b> Súbela aquí abajo y revisa la vista previa antes de confirmar.</li>
      </ol>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Upload size={16}/>Elegir archivo CSV<input type="file" accept=".csv,text/csv" onChange={pick} className="hidden"/></label>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>

    {headers.length > 0 && !result && <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">Qué columna es cada dato</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {FIELDS.map(([key, label]) => <label key={key} className="text-sm font-semibold">{label}
          <select value={mapping[key] ?? -1} onChange={(event) => changeMapping(key, Number(event.target.value))} className="mt-2 w-full rounded-xl border p-3">
            <option value={-1}>No importar</option>
            {headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Columna ${index + 1}`}</option>)}
          </select>
        </label>)}
      </div>

      <h2 className="mt-6 font-extrabold">Vista previa</h2>
      <p className="text-sm text-[#736f83]">{valid} de {rows.length} filas se pueden importar (las que tienen nombre).</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-[#f7f6fa] text-xs uppercase text-[#736f83]"><tr><th className="p-3">Nombre</th><th>Teléfono</th><th>Correo</th><th>Nacimiento</th></tr></thead>
          <tbody>{rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t border-black/5"><td className="p-3">{row.fullName || <span className="text-red-600">Sin nombre</span>}</td><td>{row.phone}</td><td>{row.email}</td><td>{row.birthday}</td></tr>)}</tbody>
        </table>
      </div>
      {rows.length > 10 && <p className="mt-2 text-xs text-[#736f83]">Se muestran las primeras 10 filas de {rows.length}.</p>}

      <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
        <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} className="mt-1"/>
        <span>Estas personas autorizaron recibir promociones. Márcalo solo si es verdad: sin autorización, Agen nunca les enviará campañas.</span>
      </label>

      <button disabled={loading || valid === 0} onClick={() => void submit()} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Importando…' : `Importar ${valid} clientes`}</button>
    </section>}

    {result && <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold text-emerald-700">Se importaron {result.created} clientes.</h2>
      {result.skipped.length > 0 && <>
        <p className="mt-3 text-sm font-semibold">{result.skipped.length} filas quedaron fuera:</p>
        <ul className="mt-2 space-y-1 text-sm text-[#736f83]">{result.skipped.slice(0, 30).map((item) => <li key={item.row}>Fila {item.row}: {item.reason}</li>)}</ul>
        {result.skipped.length > 30 && <p className="mt-1 text-xs text-[#736f83]">…y {result.skipped.length - 30} más.</p>}
      </>}
      <Link href="/admin/clientes" className="mt-5 inline-block rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white">Ver mis clientes</Link>
    </section>}
  </>
}
