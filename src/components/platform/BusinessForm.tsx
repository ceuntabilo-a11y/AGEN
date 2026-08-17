'use client'
import { useMemo, useState } from 'react'
import { DURACIONES, slugDesdeNombre, vencimientoDesdeDuracion } from '@/lib/platform-business'

/**
 * El formulario de un negocio, compartido por crear y editar.
 *
 * Es el mismo en los dos sitios a propósito: cuando eran dos formularios distintos, crear pedía
 * cinco campos y editar solo dejaba tocar tres, así que un nombre mal escrito o una zona horaria
 * equivocada obligaban a borrar el negocio y volver a crearlo, perdiendo su agenda.
 */

export type ValoresNegocio = {
  name: string
  slug: string
  ownerEmail: string
  planId: string
  timezone: string
  currency: string
  isDemo: boolean
  startsOn: string
  durationDays: number | null
  expiresOn: string | null
}

export type Plan = { id: string; code: string; name: string; price?: number }

/** Zonas horarias de los mercados donde Agen se vende. La lista corta evita un desplegable inútil. */
export const ZONAS = [
  'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Lima',
  'America/Mexico_City', 'America/Montevideo', 'America/Asuncion', 'America/Caracas',
  'America/La_Paz', 'America/Guayaquil', 'America/Panama', 'America/Costa_Rica',
  'America/Santo_Domingo', 'America/New_York', 'Europe/Madrid', 'UTC',
]

export const MONEDAS = [
  ['CLP', 'Peso chileno'], ['ARS', 'Peso argentino'], ['COP', 'Peso colombiano'],
  ['PEN', 'Sol peruano'], ['MXN', 'Peso mexicano'], ['UYU', 'Peso uruguayo'],
  ['USD', 'Dólar'], ['EUR', 'Euro'],
] as const

export const hoyISO = () => new Date().toISOString().slice(0, 10)

export function valoresIniciales(): ValoresNegocio {
  return {
    name: '', slug: '', ownerEmail: '', planId: '',
    timezone: 'America/Santiago', currency: 'CLP',
    isDemo: true, startsOn: hoyISO(), durationDays: 7, expiresOn: null,
  }
}

/** El vencimiento que va a quedar, mire el administrador la duración o la fecha exacta. */
export function vencimientoFinal(valores: ValoresNegocio): string | null {
  if (valores.durationDays === null) return valores.expiresOn
  return vencimientoDesdeDuracion(valores.startsOn, valores.durationDays)
}

const campo = 'mt-1.5 w-full rounded-xl border p-3 text-sm'
const etiqueta = 'text-sm font-semibold'

export function BusinessForm({
  valores, alCambiar, planes, modo,
}: {
  valores: ValoresNegocio
  alCambiar: (siguiente: ValoresNegocio) => void
  planes: Plan[]
  modo: 'crear' | 'editar'
}) {
  // El slug se genera desde el nombre mientras nadie lo toque a mano. En cuanto se edita, manda
  // lo escrito: sobrescribirlo después sería borrarle el trabajo al administrador.
  const [slugManual, setSlugManual] = useState(modo === 'editar')
  const [verSlug, setVerSlug] = useState(false)

  const poner = (parche: Partial<ValoresNegocio>) => alCambiar({ ...valores, ...parche })
  const vence = useMemo(() => vencimientoFinal(valores), [valores])

  return <div className="grid gap-4">
    <label className={etiqueta}>
      Nombre del negocio
      <input
        value={valores.name} required autoFocus={modo === 'crear'}
        onChange={(e) => poner({ name: e.target.value, ...(slugManual ? {} : { slug: slugDesdeNombre(e.target.value) }) })}
        className={campo} placeholder="Estética Bella Vida"
      />
    </label>

    <div>
      <div className="flex items-center justify-between gap-2">
        <span className={etiqueta}>Dirección web</span>
        <button type="button" onClick={() => setVerSlug((v) => !v)} className="text-xs font-semibold text-[#5b3df5] hover:underline">
          {verSlug ? 'Ocultar' : 'Cambiar'}
        </button>
      </div>
      <p className="mt-1 text-xs text-[#736f83]">
        Es el nombre corto del negocio dentro de las direcciones de Agen. Se genera solo desde el nombre; cámbialo únicamente si hace falta.
      </p>
      {verSlug
        ? <input
          value={valores.slug}
          onChange={(e) => { setSlugManual(true); poner({ slug: e.target.value.toLowerCase() }) }}
          pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$" className={campo} placeholder="estetica-bella-vida"
        />
        : <p className="mt-1.5 rounded-xl bg-[#f7f6fa] p-3 font-mono text-sm text-[#4a4658]">{valores.slug || '—'}</p>}
    </div>

    {modo === 'crear' && <label className={etiqueta}>
      Correo del dueño
      <input
        type="email" required value={valores.ownerEmail}
        onChange={(e) => poner({ ownerEmail: e.target.value })}
        className={campo} placeholder="dueno@negocio.cl"
      />
      <span className="mt-1 block text-xs font-normal text-[#736f83]">Recibirá una invitación para crear su propia contraseña. Nunca se envía una contraseña por correo.</span>
    </label>}

    <div className="grid gap-4 sm:grid-cols-2">
      <label className={etiqueta}>
        Zona horaria
        <select value={valores.timezone} onChange={(e) => poner({ timezone: e.target.value })} className={campo}>
          {ZONAS.map((zona) => <option key={zona} value={zona}>{zona.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      <label className={etiqueta}>
        Moneda
        <select value={valores.currency} onChange={(e) => poner({ currency: e.target.value })} className={campo}>
          {MONEDAS.map(([codigo, nombre]) => <option key={codigo} value={codigo}>{codigo} · {nombre}</option>)}
        </select>
      </label>
    </div>

    <label className={etiqueta}>
      Plan
      <select value={valores.planId} onChange={(e) => poner({ planId: e.target.value })} className={campo}>
        <option value="">Sin plan</option>
        {planes.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
      </select>
    </label>

    <fieldset className="rounded-2xl border p-4">
      <legend className="px-1 text-sm font-semibold">Vigencia</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={valores.isDemo} onChange={(e) => poner({ isDemo: e.target.checked })} className="h-4 w-4" />
        Es una demo o prueba comercial
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={etiqueta}>
          Empieza el
          <input type="date" value={valores.startsOn} onChange={(e) => poner({ startsOn: e.target.value })} className={campo} />
        </label>
        <label className={etiqueta}>
          Duración
          <select
            value={valores.durationDays === null ? 'exacta' : String(valores.durationDays)}
            onChange={(e) => poner(e.target.value === 'exacta'
              ? { durationDays: null, expiresOn: valores.expiresOn ?? vencimientoFinal(valores) }
              : e.target.value === 'sin'
                ? { durationDays: null, expiresOn: null }
                : { durationDays: Number(e.target.value), expiresOn: null })}
            className={campo}
          >
            {DURACIONES.map((dias) => <option key={dias} value={dias}>{dias} {dias === 1 ? 'día' : 'días'}</option>)}
            <option value="exacta">Fecha exacta…</option>
            <option value="sin">Sin vencimiento</option>
          </select>
        </label>
      </div>

      {valores.durationDays === null && <label className={`${etiqueta} mt-3 block`}>
        Vence el
        <input
          type="date" value={valores.expiresOn ?? ''} min={valores.startsOn}
          onChange={(e) => poner({ expiresOn: e.target.value || null })}
          className={campo}
        />
        <span className="mt-1 block text-xs font-normal text-[#736f83]">Déjalo vacío para que no venza nunca.</span>
      </label>}

      <p className="mt-3 rounded-xl bg-[#f7f6fa] p-3 text-sm">
        {vence
          ? <>Vence el <b>{new Date(`${vence}T00:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</b> (último día incluido).</>
          : <>Sin vencimiento.</>}
      </p>
    </fieldset>
  </div>
}
