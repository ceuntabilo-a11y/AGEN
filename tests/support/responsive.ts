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

/**
 * Espera a que el vídeo de bienvenida se vaya.
 *
 * `AgenSplash` se pinta sobre todo al entrar y, mientras se desvanece, se come los clics: en el
 * CI esto dejó una prueba reintentando 221 veces contra un botón que estaba tapado. Medir el
 * ancho sí se puede hacer con el splash puesto; hacer clic, no.
 */
async function esperarSinSplash(page: Page) {
  const splash = page.getByRole('status', { name: 'Iniciando Agen' })
  await splash.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {
    // En la mayoría de las cargas ni siquiera aparece: no es un fallo que no esté.
  })
}

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

      await esperarSinSplash(page)

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

      // Hay dos botones "Cerrar menú": el fondo oscuro que cubre la pantalla y la X dentro del
      // menú. Se pulsa la X — el fondo queda POR DEBAJO del menú, así que un clic en su centro
      // aterriza sobre los enlaces y no cierra nada.
      await page.locator('aside').getByRole('button', { name: 'Cerrar menú' }).click()
      await expect(abrir).toBeVisible()
      // Cerrado = el menú se va a la izquierda. Se comprueba `-translate-x-full` y no la
      // ausencia de `translate-x-0`, porque `lg:translate-x-0` está siempre en la clase.
      await expect(page.locator('aside')).toHaveClass(/-translate-x-full/)
    })
  })
}
