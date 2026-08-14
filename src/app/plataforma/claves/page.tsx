'use client'
import { PageHeader } from '@/components/PageHeader'
import { FormEvent, useEffect, useState } from 'react'

/**
 * Claves de plataforma.
 *
 * Dos cosas que antes no estaban y por las que esta pantalla no servía:
 *
 * 1. Las credenciales ya no viajan al navegador. El servidor solo dice si están puestas y sus
 *    últimos caracteres. Por eso los campos de secretos salen vacíos: **dejarlos vacíos
 *    significa "no la cambies"**, no "bórrala". Para quitar una hay una casilla explícita.
 * 2. Guardar tiene estado visible: el botón se deshabilita y dice "Guardando…", el éxito se
 *    confirma diciendo qué se guardó y qué se quitó, y el error muestra lo que respondió el
 *    servidor en vez de una frase fija.
 */

type Secreto = { configurada: boolean; pista: string | null }
type Settings = {
  openai_fallback_key: Secreto
  dashscope_fallback_key: Secreto
  evolution_api_key: Secreto
  resend_api_key: Secreto
  dashscope_fallback_endpoint: string | null
  evolution_api_url: string | null
  resend_from: string | null
}

/** Campos de credencial: van vacíos, con casilla para quitarlos. */
const SECRETOS = [
  { clave: 'openai_fallback_key', etiqueta: 'Clave OpenAI de respaldo', ejemplo: 'sk-…' },
  { clave: 'dashscope_fallback_key', etiqueta: 'Clave DashScope (voz) de respaldo', ejemplo: 'sk-…' },
  { clave: 'evolution_api_key', etiqueta: 'Clave de Evolution API', ejemplo: '' },
  { clave: 'resend_api_key', etiqueta: 'Clave de Resend (correo de marketing)', ejemplo: 're_…' },
] as const

/** Campos que no son credenciales: se muestran y se editan tal cual. */
const TEXTOS = [
  { clave: 'dashscope_fallback_endpoint', etiqueta: 'Endpoint dedicado de DashScope (solo si tu clave es de un workspace, ej. sk-ws-…)', ejemplo: '' },
  { clave: 'evolution_api_url', etiqueta: 'URL de Evolution API (solo si vas a usar WhatsApp por QR)', ejemplo: 'https://tu-evolution-api.com' },
  { clave: 'resend_from', etiqueta: 'Remitente de Resend (dominio ya verificado en Resend)', ejemplo: 'Agen <notificaciones@tu-dominio.com>' },
] as const

export default function PlatformKeysPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState('')
  const [error, setError] = useState('')

  async function cargar() {
    try {
      const respuesta = await fetch('/api/platform/settings')
      if (!respuesta.ok) throw new Error()
      const datos = await respuesta.json()
      setSettings(datos.settings)
    } catch {
      setExito('')
      setError('No se pudieron cargar las claves.')
    }
  }

  useEffect(() => { void cargar() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings) return

    // El elemento se captura ANTES de cualquier await. React anula `event.currentTarget` en
    // cuanto el manejador cede el control, así que usarlo después del fetch lanzaba un
    // TypeError que caía en el catch: la pantalla mostraba "No se pudo contactar al servidor"
    // pegado al "Listo" del guardado que sí había funcionado.
    const formulario = event.currentTarget
    const form = new FormData(formulario)

    setExito(''); setError(''); setGuardando(true)

    /*
     * Solo viaja lo que el administrador tocó de verdad.
     *
     * Antes, los tres campos de texto se mandaban SIEMPRE, así que cada guardado reescribía
     * el endpoint, la URL de Evolution y el remitente de Resend —y borraba los que estuvieran
     * en blanco— aunque solo se hubiera cambiado una credencial. De ahí el "3 guardada(s) y
     * 1 quitada(s)" al tocar una sola clave: no era un conteo mal hecho, se estaban tocando
     * filas ajenas.
     */
    const cuerpo: Record<string, string | null> = {}

    for (const { clave } of SECRETOS) {
      const quitar = form.get(`${clave}__quitar`) === 'on'
      const escrito = String(form.get(clave) ?? '').trim()
      if (quitar) cuerpo[clave] = ''
      else if (escrito) cuerpo[clave] = escrito
      // Vacío y sin marcar "quitar": no se envía. No se toca.
    }

    for (const { clave } of TEXTOS) {
      const escrito = String(form.get(clave) ?? '').trim()
      const actual = settings[clave] ?? ''
      if (escrito !== actual) cuerpo[clave] = escrito
    }

    if (Object.keys(cuerpo).length === 0) {
      setGuardando(false)
      setError('No cambiaste nada. Escribe una clave nueva o marca "Quitar esta clave".')
      return
    }

    try {
      const respuesta = await fetch('/api/platform/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const datos = await respuesta.json().catch(() => ({})) as { error?: string; guardadas?: string[]; quitadas?: string[] }

      if (!respuesta.ok) {
        setExito('')
        setError(datos.error || 'No se pudo guardar.')
        return
      }

      const partes = []
      if (datos.guardadas?.length) partes.push(`${datos.guardadas.length} guardada(s)`)
      if (datos.quitadas?.length) partes.push(`${datos.quitadas.length} quitada(s)`)
      setError('')
      setExito(`Listo: ${partes.join(' y ') || 'sin cambios'}.`)
      formulario.reset()
      await cargar()
    } catch {
      // Solo se llega acá si el fetch falló de verdad. El éxito se limpia para que nunca
      // convivan los dos mensajes.
      setExito('')
      setError('No se pudo contactar al servidor. Revisa la conexión e inténtalo de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return <>
    <PageHeader title="Claves de plataforma" description="Todo lo que necesita la plataforma para funcionar, sin tocar archivos ni el servidor." />

    {error && <p role="alert" className="mb-4 rounded-xl border-t-4 border-red-500 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
    {exito && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{exito}</p>}

    {settings && <form onSubmit={submit} onChange={() => { setExito(''); setError('') }} className="grid max-w-xl gap-5 rounded-2xl border bg-white p-5">
      {SECRETOS.map(({ clave, etiqueta, ejemplo }) => {
        const estado = settings[clave]
        return <div key={clave}>
          <label className="block text-sm font-semibold">
            {etiqueta}
            <input
              name={clave}
              type="password"
              autoComplete="off"
              placeholder={estado.configurada ? `Guardada (${estado.pista}) — escribe una nueva para reemplazarla` : ejemplo}
              className="mt-2 w-full rounded-xl border p-3 font-mono text-sm"
            />
          </label>
          {estado.configurada && <label className="mt-2 flex items-center gap-2 text-xs text-[#736f83]">
            <input name={`${clave}__quitar`} type="checkbox" /> Quitar esta clave
          </label>}
        </div>
      })}

      {TEXTOS.map(({ clave, etiqueta, ejemplo }) => (
        <label key={clave} className="block text-sm font-semibold">
          {etiqueta}
          <input name={clave} type="text" defaultValue={settings[clave] ?? ''} placeholder={ejemplo} className="mt-2 w-full rounded-xl border p-3 font-mono text-sm" />
        </label>
      ))}

      <p className="text-xs leading-5 text-[#736f83]">
        Las claves guardadas no se muestran: el servidor solo confirma que están puestas. Un campo
        vacío deja la clave como está; para borrarla marca &quot;Quitar esta clave&quot;.
        Una sola clave de Resend sirve para el correo de marketing de todos los negocios.
      </p>

      <button disabled={guardando} className="rounded-xl bg-[#5b3df5] px-5 py-3 font-bold text-white disabled:opacity-50">
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </form>}
  </>
}
