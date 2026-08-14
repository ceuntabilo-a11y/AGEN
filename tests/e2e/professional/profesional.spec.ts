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

  test('la agenda es un calendario: eje de horas, vistas y navegación', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    // Lo que faltaba: sin eje de horas ni vistas era una lista, no una agenda.
    await expect(page.getByRole('button', { name: 'Día', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Semana', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Anterior' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeVisible()
    await expect(page.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible()
  })

  test('cambiar a vista Día y volver a Semana no rompe la agenda', async ({ page }) => {
    const vigilante = watchErrors(page)
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: 'Día', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Día', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Semana', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Semana', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(vigilante.errors).toEqual([])
  })

  test('avanzar y volver a Hoy deja la agenda utilizable', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await page.getByRole('button', { name: 'Anterior' }).click()
    await page.getByRole('button', { name: 'Hoy', exact: true }).click()
    await expect(page.getByText(/^\d{2}:\d{2}$/).first()).toBeVisible()
  })

  test('el bloqueo de horario pide desde, hasta y motivo, en la zona del negocio', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: 'Bloquear horario' }).click()
    const dialogo = modal(page, 'Bloquear horario')
    await expect(dialogo.locator('[name="from"]')).toBeVisible()
    await expect(dialogo.locator('[name="until"]')).toBeVisible()
    // El aviso de la zona importa: un datetime-local no lleva huso y antes se interpretaba
    // en el del navegador, así que se bloqueaba una hora distinta de la que se veía.
    await expect(dialogo.getByText(/las del negocio/)).toBeVisible()
    await cerrarModal(page, 'Bloquear horario')
  })

  test('compartir el calendario sigue estando, como función secundaria', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByText('Ver también en Google Calendar').click()
    await expect(page.getByRole('button', { name: 'Generar enlace privado' })).toBeVisible()
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
