'use client'

import { PageHeader } from '@/components/PageHeader'
import { AlertCircle, ArrowLeft, FileText, Sparkles, Upload } from 'lucide-react'
import Link from 'next/link'
import { ChangeEvent, useState } from 'react'
import { parseVCard } from '@/lib/vcard'
import { CAMPOS_IMPORTACION, autoMapear, celdaATexto, mapearFilas, parseCsv, type FilaImportada } from '@/lib/import-clientes'
import readXlsxFile from 'read-excel-file/browser'

type Row = FilaImportada
const FIELDS = CAMPOS_IMPORTACION

/**
 * Un bloque es un archivo ya leído. "tabla" (CSV/Excel) trae columnas para emparejar a mano;
 * "directo" (contactos .vcf, o texto suelto ya interpretado por IA) ya llega como filas.
 */
type Bloque = {
  id: string
  archivo: string
  formato: 'CSV' | 'Excel' | 'Word' | 'Texto' | 'Contactos'
  estado: 'leyendo' | 'listo' | 'error'
  error: string
  headers: string[]
  raw: string[][]
  mapping: Record<string, number>
  rows: Row[]
}

const bloqueVacio = (id: string, archivo: string, formato: Bloque['formato']): Bloque =>
  ({ id, archivo, formato, estado: 'leyendo', error: '', headers: [], raw: [], mapping: {}, rows: [] })

async function extraerConIA(texto: string): Promise<{ rows: Row[]; truncated?: boolean }> {
  const response = await fetch('/api/admin/clients/import/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: texto }) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? 'No se pudo leer el archivo con IA')
  return data
}

export default function ImportClientsPage() {
  const [bloques, setBloques] = useState<Bloque[]>([])
  const [marketing, setMarketing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: Array<{ row: number; reason: string }> } | null>(null)
  const [loading, setLoading] = useState(false)

  function actualizarBloque(id: string, cambios: Partial<Bloque>) {
    setBloques((actual) => actual.map((bloque) => bloque.id === id ? { ...bloque, ...cambios } : bloque))
  }

  async function procesarArchivo(file: File) {
    const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const nombre = file.name.toLowerCase()
    const formato: Bloque['formato'] | null =
      nombre.endsWith('.csv') ? 'CSV' :
      nombre.endsWith('.xlsx') ? 'Excel' :
      nombre.endsWith('.docx') ? 'Word' :
      nombre.endsWith('.vcf') ? 'Contactos' :
      nombre.endsWith('.txt') ? 'Texto' : null

    if (!formato) {
      setBloques((actual) => [...actual, { ...bloqueVacio(id, file.name, 'CSV'), estado: 'error', error: 'Formato no reconocido. Usa CSV, Excel (.xlsx), Word (.docx), .txt o contactos (.vcf).' }])
      return
    }
    setBloques((actual) => [...actual, bloqueVacio(id, file.name, formato)])

    try {
      if (formato === 'CSV') {
        const data = parseCsv(await file.text())
        if (data.length < 2) throw new Error('El archivo no tiene filas de datos.')
        const headers = data[0].map((cell) => cell.trim())
        const mapping = autoMapear(headers)
        actualizarBloque(id, { estado: 'listo', headers, raw: data, mapping, rows: mapearFilas(data, mapping) })
        return
      }
      if (formato === 'Excel') {
        const hojas = await readXlsxFile(file)
        const primera = hojas[0]
        if (!primera) throw new Error('El archivo no tiene ninguna hoja con datos.')
        const data = primera.data.map((fila) => fila.map(celdaATexto))
        if (data.length < 2) throw new Error('El archivo no tiene filas de datos.')
        const headers = data[0].map((cell) => cell.trim())
        const mapping = autoMapear(headers)
        actualizarBloque(id, { estado: 'listo', headers, raw: data, mapping, rows: mapearFilas(data, mapping) })
        return
      }
      if (formato === 'Contactos') {
        const rows = parseVCard(await file.text())
        if (!rows.length) throw new Error('No se reconoció ningún contacto en el archivo.')
        actualizarBloque(id, { estado: 'listo', rows })
        return
      }
      if (formato === 'Texto') {
        const { rows, truncated } = await extraerConIA(await file.text())
        if (!rows.length) throw new Error('La IA no encontró ningún cliente reconocible en el texto.')
        actualizarBloque(id, { estado: 'listo', rows, error: truncated ? 'El archivo era muy largo: se leyó solo la primera parte.' : '' })
        return
      }
      // Word: pasa primero por el servidor para sacarle el texto, y ese texto se manda a la IA.
      const form = new FormData()
      form.append('file', file)
      const subida = await fetch('/api/admin/clients/import/docx', { method: 'POST', body: form })
      const datos = await subida.json().catch(() => ({}))
      if (!subida.ok) throw new Error(datos.error ?? 'No se pudo leer el archivo Word')
      const { rows, truncated } = await extraerConIA(datos.text)
      if (!rows.length) throw new Error('La IA no encontró ningún cliente reconocible en el documento.')
      actualizarBloque(id, { estado: 'listo', rows, error: truncated ? 'El documento era muy largo: se leyó solo la primera parte.' : '' })
    } catch (caught) {
      actualizarBloque(id, { estado: 'error', error: caught instanceof Error ? caught.message : 'No se pudo leer el archivo' })
    }
  }

  async function agregarArchivos(event: ChangeEvent<HTMLInputElement>) {
    const lista = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!lista.length) return
    setError(''); setResult(null)
    for (const file of lista) await procesarArchivo(file)
  }

  function cambiarMapeo(bloqueId: string, campo: string, columna: number) {
    setBloques((actual) => actual.map((bloque) => {
      if (bloque.id !== bloqueId) return bloque
      const mapping = { ...bloque.mapping, [campo]: columna }
      return { ...bloque, mapping, rows: mapearFilas(bloque.raw, mapping) }
    }))
  }

  function quitarBloque(id: string) {
    setBloques((actual) => actual.filter((bloque) => bloque.id !== id))
  }

  const filas = bloques.filter((bloque) => bloque.estado === 'listo').flatMap((bloque) => bloque.rows)
  const validas = filas.filter((row) => row.fullName).length
  const hayLeyendo = bloques.some((bloque) => bloque.estado === 'leyendo')

  async function submit() {
    setLoading(true); setError(''); setResult(null)
    const response = await fetch('/api/admin/clients/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: filas, marketingOptIn: marketing }) })
    const data = await response.json().catch(() => ({}))
    setLoading(false)
    if (!response.ok) { setError(data.error ?? 'No se pudo importar'); return }
    setResult(data)
    setBloques([])
  }

  return <>
    <Link href="/admin/clientes" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#5b3df5]"><ArrowLeft size={16}/>Volver a clientes</Link>
    <PageHeader title="Importar clientes" description="Sube tus archivos y revisa antes de guardar. Nunca se pisa un cliente que ya existe."/>

    <section className="rounded-2xl border border-black/5 bg-white p-5">
      <ol className="mb-5 space-y-1 text-sm text-[#4b4761]">
        <li><b>1.</b> Sube uno o varios archivos: CSV, Excel (.xlsx), Word (.docx), texto (.txt) o contactos exportados (.vcf).</li>
        <li><b>2.</b> En CSV y Excel, la primera fila debe tener los títulos de las columnas (Nombre, Teléfono, Correo…).</li>
        <li><b>3.</b> En Word, texto o contactos, la IA busca los datos sola — revisa igual antes de confirmar.</li>
      </ol>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white">
        <Upload size={16}/>Elegir archivos
        <input type="file" multiple accept=".csv,text/csv,.xlsx,.docx,.txt,text/plain,.vcf" onChange={agregarArchivos} className="hidden"/>
      </label>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>

    {bloques.length > 0 && <section className="mt-6 space-y-4">
      {bloques.map((bloque) => <div key={bloque.id} className="rounded-2xl border border-black/5 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold"><FileText size={16} className="text-[#5b3df5]"/>{bloque.archivo}<span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-[#5b3df5]">{bloque.formato}</span></div>
          <button type="button" onClick={() => quitarBloque(bloque.id)} className="text-xs font-bold text-red-600">Quitar</button>
        </div>
        {bloque.estado === 'leyendo' && <p className="mt-2 text-sm text-[#736f83]">Leyendo…</p>}
        {bloque.estado === 'error' && <p className="mt-2 flex items-center gap-2 text-sm text-red-600"><AlertCircle size={15}/>{bloque.error}</p>}
        {bloque.estado === 'listo' && <>
          {bloque.error && <p className="mt-2 flex items-center gap-2 text-xs text-amber-700"><AlertCircle size={13}/>{bloque.error}</p>}
          {bloque.headers.length > 0 ? <>
            <p className="mt-3 text-xs font-bold uppercase text-[#736f83]">Qué columna es cada dato</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {FIELDS.map(([key, label]) => <label key={key} className="text-xs font-semibold">{label}
                <select value={bloque.mapping[key] ?? -1} onChange={(event) => cambiarMapeo(bloque.id, key, Number(event.target.value))} className="mt-1 w-full rounded-lg border p-2 text-sm">
                  <option value={-1}>No importar</option>
                  {bloque.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Columna ${index + 1}`}</option>)}
                </select>
              </label>)}
            </div>
          </> : <p className="mt-2 flex items-center gap-2 text-xs text-[#736f83]"><Sparkles size={13} className="text-[#5b3df5]"/>{bloque.rows.length} {bloque.rows.length === 1 ? 'contacto detectado' : 'contactos detectados'}</p>}
        </>}
      </div>)}
    </section>}

    {filas.length > 0 && !result && <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5">
      <h2 className="font-extrabold">Vista previa combinada</h2>
      <p className="text-sm text-[#736f83]">{validas} de {filas.length} filas se pueden importar (las que tienen nombre), de {bloques.filter((b) => b.estado === 'listo').length} archivo(s).</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-[#f7f6fa] text-xs uppercase text-[#736f83]"><tr><th className="p-3">Nombre</th><th>Teléfono</th><th>Correo</th><th>Nacimiento</th></tr></thead>
          <tbody>{filas.slice(0, 15).map((row, index) => <tr key={index} className="border-t border-black/5"><td className="p-3">{row.fullName || <span className="text-red-600">Sin nombre</span>}</td><td>{row.phone}</td><td>{row.email}</td><td>{row.birthday}</td></tr>)}</tbody>
        </table>
      </div>
      {filas.length > 15 && <p className="mt-2 text-xs text-[#736f83]">Se muestran las primeras 15 filas de {filas.length}.</p>}

      <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">
        <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} className="mt-1"/>
        <span>Estas personas autorizaron recibir promociones. Márcalo solo si es verdad: sin autorización, Agen nunca les enviará campañas.</span>
      </label>

      <button disabled={loading || validas === 0 || hayLeyendo} onClick={() => void submit()} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{loading ? 'Importando…' : hayLeyendo ? 'Esperando archivos…' : `Importar ${validas} clientes`}</button>
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
