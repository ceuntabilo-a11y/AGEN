import { test, expect } from '@playwright/test'
import { ROLE_PAGES, cerrarModal, irA, modal, watchErrors } from '../../support/pages'

test.describe('Profesional', () => {
  for (const { path, heading } of ROLE_PAGES.professional) {
    test(`carga ${path} sin errores`, async ({ page }) => {
      const vigilante = watchErrors(page)
      await irA(page, path, heading)
      expect(vigilante.errors, `errores en ${path}`).toEqual([])
    })
  }

  test('la agenda propia ofrece bloquear horario y compartir calendario', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await expect(page.getByRole('button', { name: 'Bloquear horario' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generar enlace privado' })).toBeVisible()
  })

  test('el bloqueo de horario pide desde, hasta y motivo', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: 'Bloquear horario' }).click()
    const dialogo = modal(page, 'Bloquear horario')
    await expect(dialogo.locator('[name="from"]')).toBeVisible()
    await expect(dialogo.locator('[name="until"]')).toBeVisible()
    await cerrarModal(page, 'Bloquear horario')
  })

  test('mi horario muestra la semana del profesional', async ({ page }) => {
    await irA(page, '/profesional/horario', 'Mi horario')
    await expect(page.getByText(/Lunes|Martes|Miércoles/).first()).toBeVisible({ timeout: 30000 })
  })

  test('el profesional no accede al panel de administración', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/profesional/)
  })

  test('el profesional no accede al panel de plataforma', async ({ page }) => {
    await page.goto('/plataforma')
    await expect(page).toHaveURL(/\/profesional/)
  })
})
