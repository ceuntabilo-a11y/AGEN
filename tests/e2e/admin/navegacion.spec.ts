import { test, expect } from '@playwright/test'
import { ROLE_PAGES, irA, watchErrors } from '../../support/pages'

test.describe('Admin — navegación', () => {
  for (const { path, heading } of ROLE_PAGES.admin) {
    test(`carga ${path} sin errores`, async ({ page }) => {
      const vigilante = watchErrors(page)
      await irA(page, path, heading)
      expect(vigilante.errors, `errores en ${path}`).toEqual([])
    })
  }

  test('el chrome del panel está en todas las páginas', async ({ page }) => {
    await irA(page, '/admin', 'Resumen del negocio')
    await expect(page.getByRole('button', { name: 'Notificaciones' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Menú de usuario' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Abrir el asistente de Agen' })).toBeVisible()
  })
})
