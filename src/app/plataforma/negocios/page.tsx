'use client'
import { ModalShell } from '@/components/ModalShell'
import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { Mail, Pencil, Plus, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { BusinessForm, hoyISO, valoresIniciales, vencimientoFinal, type Plan, type ValoresNegocio } from '@/components/platform/BusinessForm'
import { ETIQUETA_ESTADO, type EstadoNegocio } from '@/lib/platform-business'

/**
 * Negocios de la plataforma: crear, editar, suspender, invitar al dueño y eliminar.
 *
 * Toda acción que escribe sigue el mismo camino, y es lo que faltaba: pulsar → botón bloqueado
 * mientras corre → resultado real → mensaje visible. Sin el bloqueo, un doble clic creaba dos
 * negocios; sin el mensaje, el administrador no sabía si había pasado algo.
 */

type Invitacion = { email: string; status: 'PENDING' | 'ACCEPTED' | 'EXPIRED'; sent_at: string; expires_at: string; accepted_at: string | null; sent_count: number }

type Negocio = {
  id: string; name: string; slug: string; active: boolean; suspended_at: string | null; created_at: string
  timezone: string; currency: string; whatsapp_provider: string | null; plan_id: string | null
  is_demo: boolean; starts_on: string | null; expires_on: string | null; converted_at: string | null
  estado: EstadoNegocio; restantes: number | null
  membership_plans: { code: string; name: string; price: number } | null
  invitacion: Invitacion | null
}

const COLOR_ESTADO: Record<EstadoNegocio, string> = {
  ACTIVO: 'bg-emerald-50 text-emerald-700',
  DEMO: 'bg-[#efeaff] text-[#5b3df5]',
  PENDIENTE: 'bg-amber-50 text-amber-800',
  VENCIDO: 'bg-red-50 text-red-700',
  SUSPENDIDO: 'bg-amber-50 text-amber-800',
  INACTIVO: 'bg-[#f1eff7] text-[#736f83]',
}

const ESTADO_INVITACION: Record<Invitacion['status'], { texto: string; clase: string }> = {
  PENDING: { texto: 'Invitación pendiente', clase: 'text-amber-700' },
  ACCEPTED: { texto: 'Acceso activado', clase: 'text-emerald-700' },
  EXPIRED: { texto: 'Invitación vencida', clase: 'text-red-700' },
}

const fechaLarga = (valor: string | null) =>
  valor ? new Date(`${valor}T00:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

function restante(dias: number | null) {
  if (dias === null) return 'Sin vencimiento'
  if (dias < 0) return `Venció hace ${Math.abs(dias)} d`
  if (dias === 0) return 'Vence hoy'
  return `${dias} ${dias === 1 ? 'día' : 'días'}`
}

/** El resumen que se lee ANTES de crear: lo que se va a crear, con todas sus letras. */
function ResumenCreacion({ valores, planes }: { valores: ValoresNegocio; planes: Plan[] }) {
  const vence = vencimientoFinal(valores)
  const filas: Array<[string, string]> = [
    ['Nombre', valores.name],
    ['Dirección web', valores.slug],
    ['Correo del dueño', valores.ownerEmail],
    ['Plan', planes.find((p) => p.id === valores.planId)?.name ?? 'Sin plan'],
    ['Tipo', valores.isDemo ? 'Demo o prueba' : 'Cliente'],
    ['Empieza', fechaLarga(valores.startsOn)],
    ['Vence', vence ? fechaLarga(vence) : 'Sin vencimiento'],
    ['Zona horaria', valores.timezone.replace(/_/g, ' ')],
    ['Moneda', valores.currency],
  ]
  return <dl className="divide-y rounded-2xl border">
    {filas.map(([clave, valor]) => <div key={clave} className="flex items-start justify-between gap-4 p-3 text-sm">
      <dt className="text-[#736f83]">{clave}</dt>
      <dd className="text-right font-semibold">{valor || '—'}</dd>
    </div>)}
  </dl>
}

export default function PlatformBusinessesPage() {
  const [negocios, setNegocios] = useState<Negocio[]>([])
  const [planes, setPlanes] = useState<Plan[]>([])
  const [error, setError] = useState('')
  /*
   * El aviso lleva su gravedad: si el negocio se creó pero el correo NO salió, pintarlo en
   * verde como si todo hubiera ido bien deja al dueño esperando una invitación que nunca
   * llegó. Verde = terminado; ámbar = hecho a medias y hay que actuar.
   */
  const [aviso, setAviso] = useState<{ texto: string; grave: boolean } | null>(null)

  const [creando, setCreando] = useState<ValoresNegocio | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [editando, setEditando] = useState<{ negocio: Negocio; valores: ValoresNegocio } | null>(null)
  const [borrando, setBorrando] = useState<Negocio | null>(null)
  const [enlace, setEnlace] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [errorModal, setErrorModal] = useState('')

  const cargar = useCallback(() => {
    fetch('/api/platform/businesses', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => setNegocios(d.businesses ?? []))
      .catch(() => setError('No se pudieron cargar los negocios.'))
    fetch('/api/platform/plans', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d) => setPlanes(d.plans ?? []))
      .catch(() => { /* la lista de planes no es imprescindible para ver los negocios */ })
  }, [])
  useEffect(() => { cargar() }, [cargar])

  /** Una sola puerta para todo lo que escribe: bloquea, ejecuta, informa y recarga. */
  async function ejecutar(clave: string, peticion: () => Promise<Response>, alTerminar?: (datos: Record<string, unknown>) => void) {
    if (trabajando) return
    setTrabajando(clave); setErrorModal(''); setAviso(null)
    try {
      const respuesta = await peticion()
      const datos = await respuesta.json().catch(() => ({})) as Record<string, unknown>
      if (!respuesta.ok) { setErrorModal(String(datos.error ?? 'No se pudo completar la acción.')); return }
      alTerminar?.(datos)
      cargar()
    } catch {
      setErrorModal('No se pudo contactar al servidor. Revisa tu conexión.')
    } finally {
      setTrabajando(null)
    }
  }

  const crear = () => creando && ejecutar('crear', () => fetch('/api/platform/businesses', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: creando.name, slug: creando.slug, ownerEmail: creando.ownerEmail,
      planId: creando.planId || null, timezone: creando.timezone, currency: creando.currency,
      isDemo: creando.isDemo, startsOn: creando.startsOn,
      durationDays: creando.durationDays, expiresOn: creando.durationDays === null ? creando.expiresOn : undefined,
    }),
  }), (datos) => {
    setCreando(null); setConfirmando(false)
    setEnlace(typeof datos.inviteLink === 'string' ? datos.inviteLink : null)
    setAviso(datos.correoEnviado
      ? { texto: 'Negocio creado y correo de invitación enviado al dueño. Si en unos minutos dice que no le llegó, dile que revise spam o promociones — a veces el primer correo de un remitente nuevo cae ahí.', grave: false }
      : datos.cuentaExistente
        ? { texto: 'Negocio creado. El dueño ya tenía cuenta: entra con su contraseña de siempre.', grave: false }
        : { texto: 'Negocio creado, pero el correo NO se pudo enviar. Copia el enlace y mándaselo tú, o vuelve a intentarlo con «Reenviar invitación».', grave: true })
  })

  const guardar = () => editando && ejecutar('editar', () => fetch(`/api/platform/businesses/${editando.negocio.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: editando.valores.name, slug: editando.valores.slug, planId: editando.valores.planId || null,
      timezone: editando.valores.timezone, currency: editando.valores.currency,
      isDemo: editando.valores.isDemo, startsOn: editando.valores.startsOn,
      durationDays: editando.valores.durationDays,
      expiresOn: editando.valores.durationDays === null ? editando.valores.expiresOn : undefined,
    }),
  }), () => { setEditando(null); setAviso({ texto: 'Cambios guardados.', grave: false }) })

  const reenviar = (negocio: Negocio) => ejecutar(`invitar-${negocio.id}`, () =>
    fetch(`/api/platform/businesses/${negocio.id}/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  (datos) => {
    setEnlace(typeof datos.inviteLink === 'string' ? datos.inviteLink : null)
    setAviso(datos.correoEnviado
      ? { texto: 'Invitación reenviada por correo. Si dice que no le llegó, dile que revise spam o promociones.', grave: false }
      : datos.cuentaExistente
        ? { texto: 'Ese dueño ya activó su cuenta: puede entrar con su contraseña.', grave: false }
        : { texto: 'El correo NO se pudo enviar. Copia el enlace y mándaselo tú.', grave: true })
  })

  const suspender = (negocio: Negocio) => ejecutar(`suspender-${negocio.id}`, () =>
    fetch(`/api/platform/businesses/${negocio.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ suspended: !negocio.suspended_at }),
    }), () => setAviso({ texto: negocio.suspended_at ? 'Negocio reactivado.' : 'Negocio suspendido.', grave: false }))

  const abrirEdicion = (negocio: Negocio) => setEditando({
    negocio,
    valores: {
      name: negocio.name, slug: negocio.slug, ownerEmail: negocio.invitacion?.email ?? '',
      planId: negocio.plan_id ?? '', timezone: negocio.timezone, currency: negocio.currency,
      isDemo: negocio.is_demo, startsOn: negocio.starts_on ?? hoyISO(),
      durationDays: null, expiresOn: negocio.expires_on,
    },
  })

  const ocupado = (clave: string) => trabajando === clave

  return <>
    <PageHeader
      title="Negocios" description="Todos los negocios de Agen: vigencia, plan y acceso de su dueño."
      action={<button onClick={() => { setCreando(valoresIniciales()); setErrorModal('') }} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white">
        <Plus size={17} />Nuevo negocio
      </button>}
    />

    {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    {aviso && <p className={`mb-4 rounded-xl p-3 text-sm ${aviso.grave ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`} role="status">{aviso.texto}</p>}

    <div className="overflow-x-auto rounded-2xl border bg-white">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-[#f7f6fa] text-xs uppercase text-[#736f83]">
          <tr><th className="p-3">Negocio</th><th>Plan</th><th>Vigencia</th><th>Acceso del dueño</th><th>Estado</th><th className="p-3 text-right">Acciones</th></tr>
        </thead>
        <tbody>
          {negocios.map((negocio) => <tr key={negocio.id} className="border-t">
            <td className="p-3"><b>{negocio.name}</b><p className="text-xs text-[#736f83]">{negocio.slug} · {negocio.currency} · {negocio.timezone.replace(/_/g, ' ')}</p></td>
            <td>{negocio.membership_plans?.name ?? 'Sin plan'}</td>
            <td>
              <p>{negocio.expires_on ? fechaLarga(negocio.expires_on) : 'Sin vencimiento'}</p>
              <p className={`text-xs ${negocio.restantes !== null && negocio.restantes <= 2 ? 'font-bold text-red-600' : 'text-[#736f83]'}`}>{restante(negocio.restantes)}</p>
            </td>
            <td>
              {negocio.invitacion
                ? <><p className={`text-xs font-bold ${ESTADO_INVITACION[negocio.invitacion.status].clase}`}>{ESTADO_INVITACION[negocio.invitacion.status].texto}</p>
                  <p className="text-xs text-[#736f83]">{negocio.invitacion.email}</p></>
                : <span className="text-xs text-[#9a96a5]">Sin invitación</span>}
            </td>
            <td><span className={`rounded-full px-2 py-1 text-xs font-bold ${COLOR_ESTADO[negocio.estado]}`}>{ETIQUETA_ESTADO[negocio.estado]}</span></td>
            <td className="p-3 text-right">
              <div className="inline-flex gap-2">
                <button title="Editar" onClick={() => abrirEdicion(negocio)} className="rounded-lg border p-2"><Pencil size={16} /></button>
                <button title="Reenviar invitación al dueño" disabled={ocupado(`invitar-${negocio.id}`)} onClick={() => reenviar(negocio)} className="rounded-lg border p-2 disabled:opacity-40"><Mail size={16} /></button>
                <button title={negocio.suspended_at ? 'Reactivar' : 'Suspender'} disabled={ocupado(`suspender-${negocio.id}`)} onClick={() => suspender(negocio)} className="rounded-lg border p-2 disabled:opacity-40">
                  {negocio.suspended_at ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
                </button>
                <button title="Eliminar" onClick={() => { setBorrando(negocio); setErrorModal('') }} className="rounded-lg border border-red-200 p-2 text-red-600"><Trash2 size={16} /></button>
              </div>
            </td>
          </tr>)}
          {negocios.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm text-[#736f83]">Aún no hay negocios.</td></tr>}
        </tbody>
      </table>
    </div>

    {creando && !confirmando && <ModalShell titulo="Nuevo negocio" onClose={() => setCreando(null)}>
      <form
        onSubmit={(e) => { e.preventDefault(); setConfirmando(true) }}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6"
      >
        <h2 className="text-xl font-black">Nuevo negocio</h2>
        <p className="mt-1 text-sm text-[#736f83]">Antes de crearlo vas a poder revisar todo.</p>
        <div className="mt-5"><BusinessForm modo="crear" valores={creando} alCambiar={setCreando} planes={planes} /></div>
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={() => setCreando(null)} className="flex-1 rounded-xl border py-3 font-bold">Cancelar</button>
          <button type="submit" className="flex-1 rounded-xl bg-[#5b3df5] py-3 font-bold text-white">Revisar</button>
        </div>
      </form>
    </ModalShell>}

    {creando && confirmando && <ModalShell titulo="Confirmar creación" onClose={() => setConfirmando(false)}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6">
        <h2 className="text-xl font-black">¿Creamos este negocio?</h2>
        <p className="mt-1 text-sm text-[#736f83]">Se enviará una invitación a <b>{creando.ownerEmail}</b> para que cree su contraseña. Hasta que la acepte, el negocio queda en &quot;Pendiente de activación&quot; — no cuenta como activo ni suma a tus ingresos.</p>
        <div className="mt-5"><ResumenCreacion valores={creando} planes={planes} /></div>
        {errorModal && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{errorModal}</p>}
        <div className="mt-6 flex gap-2">
          <button onClick={() => setConfirmando(false)} disabled={ocupado('crear')} className="flex-1 rounded-xl border py-3 font-bold disabled:opacity-50">Volver a editar</button>
          <button onClick={crear} disabled={ocupado('crear')} className="flex-1 rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{ocupado('crear') ? 'Creando…' : 'Confirmar creación'}</button>
        </div>
      </div>
    </ModalShell>}

    {editando && <ModalShell titulo="Editar negocio" onClose={() => setEditando(null)}>
      <form
        onSubmit={(e) => { e.preventDefault(); guardar() }}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6"
      >
        <h2 className="text-xl font-black">Editar {editando.negocio.name}</h2>
        <div className="mt-5"><BusinessForm modo="editar" valores={editando.valores} alCambiar={(valores) => setEditando({ ...editando, valores })} planes={planes} /></div>
        {errorModal && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{errorModal}</p>}
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={() => setEditando(null)} disabled={ocupado('editar')} className="flex-1 rounded-xl border py-3 font-bold disabled:opacity-50">Cancelar</button>
          <button type="submit" disabled={ocupado('editar')} className="flex-1 rounded-xl bg-[#5b3df5] py-3 font-bold text-white disabled:opacity-50">{ocupado('editar') ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </form>
    </ModalShell>}

    {borrando && <BorrarNegocio
      negocio={borrando} ocupado={ocupado('borrar')} error={errorModal}
      onCancelar={() => setBorrando(null)}
      onConfirmar={(nombre) => ejecutar('borrar', () => fetch(`/api/platform/businesses/${borrando.id}`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: nombre }),
      }), () => { setBorrando(null); setAviso({ texto: 'Negocio eliminado.', grave: false }) })}
    />}

    {enlace && <ModalShell titulo="Enlace de invitación" onClose={() => setEnlace(null)}>
      <div className="w-full max-w-lg rounded-3xl bg-white p-6">
        <h2 className="text-xl font-black">Enlace de invitación</h2>
        <p className="mt-2 text-sm text-[#736f83]">Ya se envió por correo. Si el dueño no lo recibe, pásale este enlace: caduca en 7 días y solo sirve una vez.</p>
        <input readOnly value={enlace} className="mt-3 w-full rounded-xl border bg-[#f7f6fa] p-3 text-xs" onFocus={(e) => e.target.select()} />
        <button onClick={() => setEnlace(null)} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white">Listo</button>
      </div>
    </ModalShell>}
  </>
}

function BorrarNegocio({ negocio, ocupado, error, onCancelar, onConfirmar }: {
  negocio: Negocio; ocupado: boolean; error: string
  onCancelar: () => void; onConfirmar: (nombre: string) => void
}) {
  const [valor, setValor] = useState('')
  return <ModalShell titulo="Eliminar negocio" onClose={onCancelar}>
    <div className="w-full max-w-md rounded-3xl bg-white p-6">
      <h2 className="text-xl font-black text-red-700">Eliminar {negocio.name}</h2>
      <p className="mt-2 text-sm text-[#736f83]">
        Se borran <b>todos</b> sus datos —agenda, clientes, conversaciones, campañas y galería— y las cuentas
        que no pertenezcan a otro negocio. Esto no se puede deshacer. Escribe exactamente <b>{negocio.name}</b> para confirmar.
      </p>
      <input value={valor} onChange={(e) => setValor(e.target.value)} className="mt-4 w-full rounded-xl border p-3" />
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      <div className="mt-5 flex gap-2">
        <button onClick={onCancelar} disabled={ocupado} className="flex-1 rounded-xl border py-2.5 font-bold disabled:opacity-50">Cancelar</button>
        <button onClick={() => onConfirmar(valor)} disabled={ocupado || valor !== negocio.name} className="flex-1 rounded-xl bg-red-600 py-2.5 font-bold text-white disabled:opacity-40">
          {ocupado ? 'Eliminando…' : 'Eliminar definitivamente'}
        </button>
      </div>
    </div>
  </ModalShell>
}
