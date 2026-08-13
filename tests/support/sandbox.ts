import { expect, test, type Page } from '@playwright/test'
import { baseURL } from './roles'

/**
 * Aislamiento sandbox / producción para las pruebas que ESCRIBEN.
 *
 * El problema real: la suite E2E entra con usuarios reales contra un Supabase real. Las
 * pruebas actuales solo leen, así que da igual dónde apunten. En cuanto una prueba cree, mueva
 * o cancele una reserva, apuntar mal significa tocar datos de un negocio de verdad — y además
 * disparar avisos por WhatsApp a clientes reales, porque `cancel_safe_appointment` encola un
 * aviso `CHANGED` para el cliente.
 *
 * Esta guarda es la condición previa de cualquier prueba de escritura. Exige las dos cosas a
 * la vez:
 *
 *  1. **Destino local.** Nunca contra un dominio desplegado. Esto protege la APLICACIÓN, no
 *     los datos: el servidor es local pero la base sigue siendo la de siempre.
 *  2. **Tenant de pruebas.** Esta es la que protege los datos. El negocio de la sesión tiene
 *     que llamarse exactamente como diga `E2E_SANDBOX_BUSINESS_NAME`. Sin esa variable no se
 *     adivina: la prueba se salta con un motivo claro, en vez de escribir en un negocio
 *     desconocido.
 *
 * Lo que NO resuelve, y hay que saberlo: sandbox y producción viven hoy en el MISMO proyecto
 * de Supabase, separados solo por `business_id`. Un fallo de multi-tenancy en la app se
 * llevaría por delante esa separación. El aislamiento de verdad —dos proyectos de Supabase—
 * necesita que el dueño cree el segundo y cargue sus claves; hasta entonces, esta guarda es lo
 * que impide que una prueba escriba en el negocio equivocado.
 */

export const VARIABLE_SANDBOX = 'E2E_SANDBOX_BUSINESS_NAME'

/** Anfitriones donde sí se puede escribir: solo la máquina de quien ejecuta la prueba. */
const LOCALES = ['localhost', '127.0.0.1', '::1', '0.0.0.0']

export function destinoEsLocal(url = baseURL()): boolean {
  try {
    // `URL.hostname` devuelve el IPv6 entre corchetes (`[::1]`); se quitan para comparar.
    return LOCALES.includes(new URL(url).hostname.replace(/^\[|\]$/g, ''))
  } catch {
    return false
  }
}

/** Motivo por el que no se puede escribir, o `null` si sí se puede. */
export function motivoParaNoEscribir(url = baseURL()): string | null {
  if (!destinoEsLocal(url)) {
    return `E2E_BASE_URL apunta a ${url}, que no es local. Las pruebas que escriben solo corren contra localhost.`
  }
  if (!process.env[VARIABLE_SANDBOX]?.trim()) {
    return `Falta ${VARIABLE_SANDBOX}: sin saber cuál es el negocio de pruebas, no se escribe en ninguno.`
  }
  return null
}

/**
 * Guarda para una prueba que escribe. Llamar como PRIMERA línea del test.
 *
 * Si no se dan las condiciones, salta la prueba con el motivo exacto. Si se dan pero la sesión
 * pertenece a otro negocio, **falla**: eso no es una prueba mal configurada, es una prueba a
 * punto de escribir donde no debe.
 */
export async function exigirSandbox(page: Page): Promise<void> {
  const motivo = motivoParaNoEscribir()
  if (motivo) {
    // eslint-disable-next-line no-console
    console.log(`[sandbox] prueba de escritura saltada — ${motivo}`)
    test.skip(true, motivo)
    return
  }

  const esperado = process.env[VARIABLE_SANDBOX]!.trim()
  const respuesta = await page.request.get('/api/session')
  expect(respuesta.ok(), 'no se pudo leer /api/session para comprobar el tenant').toBe(true)
  const sesion = await respuesta.json() as { businessName?: string }

  expect(
    sesion.businessName,
    `La sesión pertenece a "${sesion.businessName}" y el sandbox declarado es "${esperado}". ` +
      'Una prueba de escritura no puede tocar otro negocio.',
  ).toBe(esperado)
}
