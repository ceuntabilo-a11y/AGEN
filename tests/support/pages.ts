import { expect, type Page } from '@playwright/test'
import type { E2ERoleId } from './roles'

/**
 * Mapa de páginas por rol: ruta + encabezado <h1> que debe quedar visible.
 * Es la fuente única de las pruebas de navegación, así no se duplica la lista en cada spec.
 */
export const ROLE_PAGES: Record<E2ERoleId, Array<{ path: string; heading: string }>> = {
  platform: [
    { path: '/plataforma', heading: 'Resumen de plataforma' },
    { path: '/plataforma/negocios', heading: 'Negocios' },
    { path: '/plataforma/planes', heading: 'Planes y complementos' },
    { path: '/plataforma/invitaciones', heading: 'Invitaciones' },
    { path: '/plataforma/monitor', heading: 'Monitor' },
    { path: '/plataforma/claves', heading: 'Claves de plataforma' },
  ],
  admin: [
    { path: '/admin', heading: 'Resumen del negocio' },
    { path: '/admin/agenda', heading: 'Agenda general' },
    { path: '/admin/servicios', heading: 'Servicios' },
    { path: '/admin/equipo', heading: 'Equipo' },
    { path: '/admin/clientes', heading: 'Clientes' },
    { path: '/admin/clientes/importar', heading: 'Importar clientes' },
    { path: '/admin/conversaciones', heading: 'Conversaciones' },
    { path: '/admin/finanzas', heading: 'Finanzas' },
    { path: '/admin/marketing', heading: 'Marketing' },
    { path: '/admin/galeria', heading: 'Galería' },
    { path: '/admin/seguimiento', heading: 'Seguimiento y lista de espera' },
    { path: '/admin/encuestas', heading: 'Encuestas' },
    { path: '/admin/integraciones', heading: 'Integraciones' },
    { path: '/admin/configuracion', heading: 'Configuración' },
    { path: '/admin/agente', heading: 'Agente IA' },
    { path: '/admin/invitar', heading: 'Invitar' },
    { path: '/admin/ayuda', heading: 'Ayuda' },
  ],
  professional: [
    { path: '/profesional', heading: 'Mi día' },
    { path: '/profesional/agenda', heading: 'Mi agenda' },
    { path: '/profesional/clientes', heading: 'Mis clientes' },
    { path: '/profesional/horario', heading: 'Mi horario' },
    { path: '/profesional/ingresos', heading: 'Mis ingresos' },
    { path: '/profesional/estadisticas', heading: 'Mis estadísticas' },
    { path: '/profesional/galeria', heading: 'Mis trabajos' },
    { path: '/profesional/perfil', heading: 'Mi perfil' },
  ],
  client: [
    { path: '/cliente', heading: 'Mi espacio' },
    { path: '/cliente/reservar', heading: 'Reservar' },
    { path: '/cliente/reservas', heading: 'Mis reservas' },
    { path: '/cliente/perfil', heading: 'Mi perfil' },
  ],
}

/**
 * Errores de consola conocidos que no dependen de la prueba y que ya están reportados como
 * bugs. Se ignoran para que las pruebas fallen solo ante regresiones nuevas.
 */
const ERRORES_CONOCIDOS: RegExp[] = []

/** Empieza a recolectar errores de consola y de red de una página. */
export function watchErrors(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.request().method()} ${new URL(r.url()).pathname}`)
  })
  return {
    get errors() {
      return errors.filter((e) => !ERRORES_CONOCIDOS.some((known) => known.test(e)))
    },
  }
}

/** Navega y espera a que el encabezado esperado sea visible. */
export async function irA(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible({ timeout: 30000 })
}

/**
 * Contenedor de un modal. Todos pasan por `ModalShell`, así que se localizan por su rol
 * accesible y su nombre — nada de clases de CSS.
 */
export function modal(page: Page, titulo: string) {
  return page.getByRole('dialog', { name: titulo })
}

/** Cierra un modal con Escape y comprueba que efectivamente se fue. */
export async function cerrarModal(page: Page, titulo: string): Promise<void> {
  const dialogo = modal(page, titulo)
  await dialogo.press('Escape')
  await expect(dialogo).toBeHidden()
}
