'use client'

import { ChangeEvent, useState } from 'react'
import { Sparkles, Upload } from 'lucide-react'
import { ModalShell } from '@/components/ModalShell'
import { sharpenRGBA } from '@/lib/image-sharpen'

type Props = {
  professionalId: string
  professionalName: string
  brandColor: string
  specialtyName: string | null
  onClose: () => void
  onSaved: (photoUrl: string) => void
}

const ejemploDePrompt = (especialidad: string | null) =>
  especialidad
    ? `Un salón de belleza moderno y luminoso, relacionado con ${especialidad.toLowerCase()}`
    : 'Un salón de belleza moderno y luminoso'

/** Dibuja `imagen` cubriendo todo el lienzo (recorta sobrante), como el `object-fit: cover` del CSS. */
function dibujarCubriendoLienzo(ctx: CanvasRenderingContext2D, imagen: CanvasImageSource, anchoLienzo: number, altoLienzo: number, anchoImg: number, altoImg: number) {
  const escala = Math.max(anchoLienzo / anchoImg, altoLienzo / altoImg)
  const ancho = anchoImg * escala
  const alto = altoImg * escala
  ctx.drawImage(imagen, (anchoLienzo - ancho) / 2, (altoLienzo - alto) / 2, ancho, alto)
}

export function ProfessionalPhotoModal({ professionalId, professionalName, brandColor, specialtyName, onClose, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [originalUrl, setOriginalUrl] = useState('')
  const [bgMode, setBgMode] = useState<'color' | 'ia'>('color')
  const [bgColor, setBgColor] = useState(brandColor || '#5b3df5')
  const [bgPrompt, setBgPrompt] = useState(ejemploDePrompt(specialtyName))
  const [bgImage, setBgImage] = useState<string | null>(null)
  const [generandoFondo, setGenerandoFondo] = useState(false)
  const [ajustando, setAjustando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function elegirArchivo(event: ChangeEvent<HTMLInputElement>) {
    const elegido = event.target.files?.[0]
    if (!elegido) return
    setFile(elegido)
    setOriginalUrl(URL.createObjectURL(elegido))
    setResultado(null)
    setError('')
  }

  async function generarFondo() {
    if (!bgPrompt.trim()) return
    setGenerandoFondo(true); setError('')
    try {
      const response = await fetch('/api/admin/professionals/photo-background', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: bgPrompt.trim() }),
      })
      const data = await response.json().catch(() => ({})) as { image?: string; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'No se pudo generar el fondo')
      setBgImage(data.image ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo generar el fondo')
    } finally {
      setGenerandoFondo(false)
    }
  }

  async function ajustarFoto() {
    if (!file) return
    setAjustando(true); setError(''); setResultado(null)
    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const recorte = await removeBackground(file)
      const recorteBitmap = await createImageBitmap(recorte)

      const canvas = document.createElement('canvas')
      canvas.width = recorteBitmap.width
      canvas.height = recorteBitmap.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('El navegador no pudo preparar la imagen')

      if (bgMode === 'color') {
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else {
        if (!bgImage) throw new Error('Genera el fondo con IA antes de ajustar la foto')
        const fondoBlob = await (await fetch(bgImage)).blob()
        const fondoBitmap = await createImageBitmap(fondoBlob)
        dibujarCubriendoLienzo(ctx, fondoBitmap, canvas.width, canvas.height, fondoBitmap.width, fondoBitmap.height)
      }

      ctx.drawImage(recorteBitmap, 0, 0)

      const datos = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const realzado = sharpenRGBA(datos.data, canvas.width, canvas.height)
      datos.data.set(realzado)
      ctx.putImageData(datos, 0, 0)

      setResultado(canvas.toDataURL('image/jpeg', 0.92))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo ajustar la foto. Prueba con otra imagen.')
    } finally {
      setAjustando(false)
    }
  }

  async function guardar() {
    if (!resultado) return
    setGuardando(true); setError('')
    try {
      const blob = await (await fetch(resultado)).blob()
      const form = new FormData()
      form.append('file', blob, 'foto-profesional.jpg')
      form.append('kind', 'professional')
      const subida = await fetch('/api/admin/upload', { method: 'POST', body: form })
      const datosSubida = await subida.json().catch(() => ({})) as { url?: string; error?: string }
      if (!subida.ok || !datosSubida.url) throw new Error(datosSubida.error ?? 'No se pudo subir la foto')

      const cambio = await fetch('/api/admin/professionals', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: professionalId, changes: { photo_url: datosSubida.url } }),
      })
      const datosCambio = await cambio.json().catch(() => ({})) as { error?: string }
      if (!cambio.ok) throw new Error(datosCambio.error ?? 'No se pudo guardar la foto')

      onSaved(datosSubida.url)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar la foto')
    } finally {
      setGuardando(false)
    }
  }

  const puedeAjustar = Boolean(file) && (bgMode === 'color' || Boolean(bgImage)) && !ajustando

  return <ModalShell titulo="Foto del profesional" onClose={onClose}>
    <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div><h2 className="text-xl font-black">Foto del profesional</h2><p className="text-sm text-[#736f83]">{professionalName}</p></div>
      </div>

      <label className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold">
        <Upload size={16}/>{file ? 'Cambiar foto' : 'Elegir foto'}
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={elegirArchivo} className="hidden"/>
      </label>

      {file && <>
        <div className="mt-5">
          <p className="text-sm font-semibold">Fondo</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setBgMode('color')} className={`rounded-xl border px-4 py-2 text-sm font-bold ${bgMode === 'color' ? 'border-[#5b3df5] bg-violet-50 text-[#5b3df5]' : ''}`}>Color de tu marca</button>
            <button type="button" onClick={() => setBgMode('ia')} className={`rounded-xl border px-4 py-2 text-sm font-bold ${bgMode === 'ia' ? 'border-[#5b3df5] bg-violet-50 text-[#5b3df5]' : ''}`}>Fondo con IA</button>
          </div>

          {bgMode === 'color' && <label className="mt-3 flex items-center gap-3 text-sm font-semibold">Color<input type="color" value={bgColor} onChange={(event) => setBgColor(event.target.value)} className="h-10 w-16 rounded-lg border p-1"/></label>}

          {bgMode === 'ia' && <div className="mt-3 rounded-xl border border-dashed p-3">
            <textarea value={bgPrompt} onChange={(event) => setBgPrompt(event.target.value)} rows={2} maxLength={400} className="w-full rounded-lg border p-2 text-sm"/>
            <p className="mt-1 text-xs text-[#736f83]">Puedes cambiar esta descripción. Genera un fondo nuevo cada vez que la ajustes.</p>
            <button type="button" onClick={() => void generarFondo()} disabled={generandoFondo || !bgPrompt.trim()} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-bold text-[#5b3df5] disabled:opacity-40"><Sparkles size={14}/>{generandoFondo ? 'Generando…' : bgImage ? 'Generar otro fondo' : 'Generar fondo'}</button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {bgImage && <img src={bgImage} alt="Fondo generado" className="mt-3 h-32 w-full rounded-xl border object-cover"/>}
          </div>}
        </div>

        <button type="button" disabled={!puedeAjustar} onClick={() => void ajustarFoto()} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{ajustando ? 'Ajustando…' : 'Ajustar foto'}</button>
        <p className="mt-1 text-xs text-[#736f83]">La primera vez puede tardar unos segundos más: descarga lo que necesita para reconocer a la persona en la foto.</p>
      </>}

      {resultado && <div className="mt-6">
        <p className="text-sm font-semibold">Antes y después</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div><p className="mb-1 text-xs font-bold uppercase text-[#736f83]">Antes</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalUrl} alt="Foto original" className="aspect-square w-full rounded-xl border object-cover"/></div>
          <div><p className="mb-1 text-xs font-bold uppercase text-[#736f83]">Después</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultado} alt="Foto ajustada" className="aspect-square w-full rounded-xl border object-cover"/></div>
        </div>
        <button type="button" disabled={guardando} onClick={() => void guardar()} className="mt-4 w-full rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar esta foto'}</button>
      </div>}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  </ModalShell>
}
