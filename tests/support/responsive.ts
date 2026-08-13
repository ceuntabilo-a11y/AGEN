import { expect, test, type Page } from '@playwright/test'
import { ROLE_PAGES, watchErrors } from './pages'
import type { E2ERoleId } from './roles'

/**
 * Auditoría responsive por rol.
 *
 * La suite ya comprobaba que cada página carga en escritorio. Esto cubre lo que faltaba: que
 * en un teléfono —que es donde de verdad las usan el profesional y el cliente— la página no
 * se desborde a lo ancho y el menú siga siendo alcanzable.
 *
 * El desborde horizontal es el fallo típico de una tabla o un contenedor con ancho fijo: en
 * escritorio no se nota y en móvil deja la mitad de la pantalla fuera de alcance. Se mide
 * comparando `scrollWidth` con `clientWidth` del documento, que es exactamente lo que hace el
 * navegador para decidir si pinta la barra horizontal.
 *
 * Cada rol tiene su propio project de Playwright (con su sesión), así que esta función se
 * llama desde un spec dentro de la carpeta del rol.
 */

/** Teléfono de referencia: iPhone 12/13/14 en vertical. */
export const MOVIL = { width: 390, height: 844 }

/** Cuántos píxeles de desborde se toleran (redondeos de layout del navegador). */
const TOLERANCIA = 2

async function desbordeHorizontal(page: Page) {
  return page.evaluate(() => {
    const raiz = document.documentElement
    return raiz.scrollWidth - raiz.clientWidth
  })
}

export function auditoriaResponsive(rol: E2ERoleId, etiqueta: string) {
  test.describe(`${etiqueta} — responsive (${MOVIL.width}×${MOVIL.height})`, () => {
    test.use({ viewport: MOVIL })

    for (const { path, heading } of ROLE_PAGES[rol]) {
      test(`${path} no se desborda a lo ancho en móvil`, async ({ page }) => {
        const vigilante = watchErrors(page)
        await page.goto(path)
        await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible({ timeout: 30000 })
        // La cabecera se rellena con la sesión, que llega por fetch. Sin esperarla, la medida
        // sale de una cabecera a medio pintar y el desborde aparece o no según la latencia.
        await expect(page.getByRole('button', { name: 'Menú de usuario' })).toBeVisible({ timeout: 30000 })

        const desborde = await desbordeHorizontal(page)
        expect(desborde, `${path} se sale ${desborde}px del ancho de la pantalla`).toBeLessThanOrEqual(TOLERANCIA)
        expect(vigilante.errors, `errores en ${path}`).toEqual([])
      })
    }

    test('el menú lateral se abre y se cierra con el botón de móvil', async ({ page }) => {
      const { path, heading } = ROLE_PAGES[rol][0]
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible({ timeout: 30000 })

      // En escritorio el menú está siempre visible; en móvil aparece este botón.
      const abrir = page.getByRole('button', { name: 'Abrir menú' })
      await expect(abrir).toBeVisible()
      await abrir.click()

      // Con el menú abierto tienen que quedar a la vista los enlaces del rol. Se cuentan por
      // ruta, no por texto: las etiquetas del menú son cortas ("Agenda") y no coinciden con
      // los <h1> de cada página ("Agenda general").
      const rutas = ROLE_PAGES[rol].map((pagina) => pagina.path)
      const visibles = await page.getByRole('link').evaluateAll(
        (enlaces, esperadas) => enlaces.filter((enlace) => {
          const href = enlace.getAttribute('href') ?? ''
          return esperadas.includes(href) && (enlace as HTMLElement).offsetParent !== null
        }).length,
        rutas,
      )
      expect(visibles, 'el menú abierto no muestra los enlaces del rol').toBeGreaterThan(1)

      await page.getByRole('button', { name: 'Cerrar menú' }).first().click()
      await expect(abrir).toBeVisible()
    })
  })
}
