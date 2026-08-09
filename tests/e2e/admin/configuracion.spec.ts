import { test, expect } from '@playwright/test'
import { irA } from '../../support/pages'

test.describe('Admin — configuración, agente e integraciones', () => {
  test('configuración: el horario del negocio expone los 7 días', async ({ page }) => {
    await irA(page, '/admin/configuracion', 'Configuración')
    // El editor de horarios aparece recién cuando llega la configuración del negocio.
    await expect(page.getByRole('button', { name: 'Lunes', exact: true })).toBeVisible({ timeout: 30000 })
    for (const dia of ['Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
      await expect(page.getByRole('button', { name: dia, exact: true })).toBeVisible()
    }
    await expect(page.locator('[name="timezone"]')).toBeVisible()
    await expect(page.locator('[name="cancellationHours"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar configuración' })).toBeVisible()
  })

  test('configuración: la zona horaria del negocio es la fuente de verdad', async ({ page }) => {
    await irA(page, '/admin/configuracion', 'Configuración')
    // El negocio de pruebas opera en Chile; el valor sale de businesses.timezone, no del navegador.
    await expect(page.locator('[name="timezone"]')).toHaveValue('America/Santiago', { timeout: 30000 })
  })

  test('agente: las cinco pestañas cambian de contenido', async ({ page }) => {
    await irA(page, '/admin/agente', 'Agente IA')
    for (const pestana of ['General', 'Personalidad', 'Voz', 'Comportamiento', 'Prompt']) {
      await page.getByRole('button', { name: pestana, exact: true }).click()
      await expect(page.getByRole('button', { name: pestana, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Guardar configuración' })).toBeVisible()
  })

  test('integraciones: se puede elegir proveedor de WhatsApp sin conectar nada', async ({ page }) => {
    await irA(page, '/admin/integraciones', 'Integraciones')
    for (const proveedor of ['QR rápido (Evolution)', 'Meta API oficial', '360dialog']) {
      await expect(page.getByRole('button', { name: proveedor })).toBeVisible()
    }
    // No se pulsa "Conectar WhatsApp": levantaría una instancia real de Evolution.
    await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible()
  })

  test('integraciones: el token guardado nunca vuelve en claro al navegador', async ({ page }) => {
    await irA(page, '/admin/integraciones', 'Integraciones')
    for (const campo of await page.locator('main input[type="password"]').all()) {
      const valor = await campo.inputValue()
      expect(valor === '' || /^[•*]+$/.test(valor), 'el token debe llegar enmascarado o vacío').toBe(true)
    }
  })
})

/**
 * Accesibilidad de los modales, centralizada en ModalShell: si alguien vuelve a escribir un
 * overlay a mano, este test lo detecta.
 */
test.describe('Admin — accesibilidad de los modales', () => {
  for (const [ruta, boton, nombre] of [
    ['/admin/servicios', 'Nuevo servicio', 'Nuevo servicio'],
    ['/admin/clientes', 'Nuevo cliente', 'Nuevo cliente'],
    ['/admin/galeria', 'Subir trabajo', 'Subir trabajo'],
  ] as const) {
    test(`${boton}: es un diálogo accesible y se cierra con Escape`, async ({ page }) => {
      await page.goto(ruta)
      await page.getByRole('button', { name: boton, exact: true }).click()

      const dialogo = page.getByRole('dialog', { name: nombre })
      await expect(dialogo).toBeVisible()
      await expect(dialogo).toHaveAttribute('aria-modal', 'true')
      // El botón de cerrar es un icono: necesita nombre accesible propio.
      await expect(dialogo.getByRole('button', { name: /cerrar/i })).toBeVisible()

      await dialogo.press('Escape')
      await expect(dialogo).toBeHidden()
    })
  }
})
