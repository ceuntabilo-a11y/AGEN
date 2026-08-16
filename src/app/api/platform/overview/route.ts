import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/platform-context'
import { apiError } from '@/lib/http-errors'
import { AVISO_VENCIMIENTO_DIAS, diasRestantes, estadoDeNegocio } from '@/lib/platform-business'
import { urlDeN8n } from '@/lib/platform-settings'

export const dynamic = 'force-dynamic'

/**
 * Todo lo que el dueño de la plataforma necesita para entender su negocio de un vistazo.
 *
 * Antes devolvía cuatro números —negocios, profesionales, MRR y dos semáforos— y con eso no se
 * puede contestar la única pregunta comercial que importa: «esta semana entregué 50 demos,
 * ¿cuántas siguen vivas y cuántas se convirtieron?». Ahora sale de los datos reales de
 * `businesses` (demo, vigencia, conversión) y no de estimaciones.
 *
 * Las comprobaciones de salud van EN PARALELO con las consultas: encadenadas, el viaje a n8n
 * (hasta 4 s) se sumaba al de las consultas y la pantalla parecía rota.
 */

/** Techo de la comprobación de n8n. Si tarda más, para el usuario ya está caído. */
const LIMITE_N8N_MS = 4000

export type EstadoServicio = 'OPERATIVO' | 'CAIDO' | 'SIN_CONFIGURAR'

/**
 * Salud real de n8n, con la diferencia que antes no se hacía: «no configurado» y «caído» no
 * son lo mismo, y mostrar uno por el otro manda a buscar el problema donde no está.
 *
 * La URL sale de `platform_settings` y solo cae al entorno como respaldo. Ese era el fallo de
 * fondo: el monitor solo miraba `process.env.N8N_API_URL`, que existe en el portátil de quien
 * desarrolla pero no en el servicio desplegado, así que n8n salía «sin configurar» estando
 * perfectamente vivo.
 */
async function estadoDeN8n(db: { from: (tabla: string) => unknown }): Promise<EstadoServicio> {
  const base = await urlDeN8n(db)
  if (!base) return 'SIN_CONFIGURAR'
  try {
    const respuesta = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(LIMITE_N8N_MS) })
    return respuesta.ok ? 'OPERATIVO' : 'CAIDO'
  } catch {
    return 'CAIDO'
  }
}

type FilaNegocio = {
  id: string
  name: string | null
  active: boolean | null
  suspended_at: string | null
  is_demo: boolean | null
  starts_on: string | null
  expires_on: string | null
  converted_at: string | null
  created_at: string
  membership_plans?: { code?: string | null; name?: string | null; price?: number | null } | null
}

const diaISO = (fecha: Date) => fecha.toISOString().slice(0, 10)

export async function GET() {
  try {
    const { db } = await requirePlatformAdmin()
    const ahora = new Date()
    const hoy = diaISO(ahora)
    const hace7 = diaISO(new Date(ahora.getTime() - 7 * 86400000))
    const hace30 = diaISO(new Date(ahora.getTime() - 30 * 86400000))

    const [negocios, profesionales, citas, ping, n8n] = await Promise.all([
      db.from('businesses').select('id,name,active,suspended_at,is_demo,starts_on,expires_on,converted_at,created_at,membership_plans(code,name,price)'),
      db.from('professionals').select('id', { count: 'exact', head: true }).eq('active', true),
      db.from('appointments').select('id', { count: 'exact', head: true }).not('status', 'eq', 'CANCELLED'),
      db.from('businesses').select('id', { count: 'exact', head: true }).limit(1).then(
        (resultado) => !resultado.error,
        () => false,
      ),
      estadoDeN8n(db),
    ])
    if (negocios.error) throw negocios.error

    const filas = (negocios.data ?? []) as unknown as FilaNegocio[]
    const conEstado = filas.map((fila) => ({
      ...fila,
      estado: estadoDeNegocio(fila, hoy),
      restantes: diasRestantes(fila.expires_on, hoy),
    }))

    const desde = (fila: FilaNegocio, limite: string) => (fila.starts_on ?? fila.created_at.slice(0, 10)) >= limite
    const demos = conEstado.filter((fila) => fila.is_demo)
    const convertidas = filas.filter((fila) => fila.converted_at)

    /*
     * Ingresos recurrentes: solo lo que de verdad se cobra. Una demo no paga, y un negocio
     * vencido o suspendido tampoco, así que contarlos infla la cifra que sirve para decidir.
     */
    const cobrando = conEstado.filter((fila) => fila.estado === 'ACTIVO')
    const ingresosMensuales = cobrando.reduce((suma, fila) => suma + Number(fila.membership_plans?.price ?? 0), 0)

    const porPlan = new Map<string, { plan: string; negocios: number; ingresos: number }>()
    for (const fila of cobrando) {
      const nombre = fila.membership_plans?.name ?? 'Sin plan'
      const actual = porPlan.get(nombre) ?? { plan: nombre, negocios: 0, ingresos: 0 }
      actual.negocios += 1
      actual.ingresos += Number(fila.membership_plans?.price ?? 0)
      porPlan.set(nombre, actual)
    }

    const proximosAVencer = conEstado
      .filter((fila) => fila.restantes !== null && fila.restantes >= 0 && fila.restantes <= AVISO_VENCIMIENTO_DIAS)
      .sort((a, b) => (a.restantes ?? 0) - (b.restantes ?? 0))
      .map((fila) => ({ id: fila.id, nombre: fila.name, esDemo: Boolean(fila.is_demo), vence: fila.expires_on, restantes: fila.restantes }))

    const entregadas = demos.length
    return NextResponse.json({
      negocios: {
        total: filas.length,
        activos: conEstado.filter((f) => f.estado === 'ACTIVO').length,
        demos: conEstado.filter((f) => f.estado === 'DEMO').length,
        vencidos: conEstado.filter((f) => f.estado === 'VENCIDO').length,
        suspendidos: conEstado.filter((f) => f.estado === 'SUSPENDIDO').length,
        inactivos: conEstado.filter((f) => f.estado === 'INACTIVO').length,
        nuevosSemana: filas.filter((f) => desde(f, hace7)).length,
        nuevosMes: filas.filter((f) => desde(f, hace30)).length,
      },
      demos: {
        entregadas,
        activas: demos.filter((f) => f.estado === 'DEMO').length,
        vencidas: demos.filter((f) => f.estado === 'VENCIDO').length,
        convertidas: convertidas.length,
        // Sobre las entregadas, no sobre el total de negocios: es la pregunta que se hace quien vende.
        conversion: entregadas ? Math.round((convertidas.length / entregadas) * 100) : 0,
        nuevasSemana: demos.filter((f) => desde(f, hace7)).length,
        nuevasMes: demos.filter((f) => desde(f, hace30)).length,
        lista: demos
          .sort((a, b) => (a.restantes ?? 9999) - (b.restantes ?? 9999))
          .slice(0, 25)
          .map((f) => ({ id: f.id, nombre: f.name, inicio: f.starts_on, vence: f.expires_on, restantes: f.restantes, estado: f.estado, convertida: Boolean(f.converted_at) })),
      },
      ingresos: { mensualesRecurrentes: ingresosMensuales, porPlan: Array.from(porPlan.values()).sort((a, b) => b.ingresos - a.ingresos) },
      vencimientos: proximosAVencer,
      operacion: { profesionales: profesionales.count ?? 0, citas: citas.count ?? 0 },
      salud: { supabase: ping ? 'OPERATIVO' : 'CAIDO', n8n },
    })
  } catch (error) { return apiError(error) }
}
