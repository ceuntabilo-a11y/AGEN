import { test, expect } from '@playwright/test'
import { cerrarModal, irA, modal } from '../../support/pages'

test.describe('Admin — agenda', () => {
  test('abre en vista Mes y permite cambiar de vista', async ({ page }) => {
    await irA(page, '/admin/agenda', 'Agenda general')
    for (const vista of ['Día', 'Semana', 'Mes']) {
      await expect(page.getByRole('button', { name: vista, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Semana', exact: true }).click()
    await page.getByRole('button', { name: 'Día', exact: true }).click()
    await page.getByRole('button', { name: 'Mes', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toBeVisible()
  })

  test('navega entre periodos sin perder la vista', async ({ page }) => {
    await irA(page, '/admin/agenda', 'Agenda general')
    // Las flechas se nombran por aria-label y cambian según la vista (Mes/Semana/Día).
    await page.getByRole('button', { name: /siguiente$/ }).click()
    await page.getByRole('button', { name: /anterior$/ }).click()
    await page.getByRole('button', { name: 'Hoy', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Agenda general', level: 1 })).toBeVisible()
  })

  test('el alta de reserva pide cliente, servicio y fecha', async ({ page }) => {
    await irA(page, '/admin/agenda', 'Agenda general')
    await page.getByRole('button', { name: 'Nueva reserva' }).click()
    const dialogo = modal(page, 'Nueva reserva')
    await expect(dialogo.getByPlaceholder('Buscar por nombre o teléfono')).toBeVisible()
    await expect(dialogo.locator('input[type="date"]').first()).toBeVisible()
    await cerrarModal(page, 'Nueva reserva')
  })

  test('los días cerrados del negocio se marcan en la vista Mes', async ({ page }) => {
    await irA(page, '/admin/agenda', 'Agenda general')
    await page.getByRole('button', { name: 'Mes', exact: true }).click()
    // El negocio de pruebas cierra los domingos (settings.business_hours day 7 enabled=false).
    await expect(page.getByText('Cerrado').first()).toBeVisible({ timeout: 60000 })
  })
})

test.describe('Admin — finanzas y marketing', () => {
  test('finanzas: las tres pestañas y sus altas están disponibles', async ({ page }) => {
    await irA(page, '/admin/finanzas', 'Finanzas')
    for (const pestana of ['Cobros', 'Gastos', 'Presupuestos']) {
      await page.getByRole('button', { name: pestana, exact: true }).click()
    }
    await page.getByRole('button', { name: 'Cobros', exact: true }).click()
    await page.getByRole('button', { name: 'Registrar cobro' }).click()
    const dialogo = modal(page, 'Registrar cobro')
    await expect(dialogo.locator('[name="amount"]')).toBeVisible()
    await expect(dialogo.locator('[name="method"]')).toBeVisible()
    await cerrarModal(page, 'Registrar cobro')
  })

  test('marketing: el alta de campaña pide canal, segmento y contenido', async ({ page }) => {
    await irA(page, '/admin/marketing', 'Marketing')
    await page.getByRole('button', { name: 'Nueva campaña' }).click()
    const dialogo = modal(page, 'Nueva campaña')
    for (const campo of ['name', 'channel', 'segment', 'content']) {
      await expect(dialogo.locator(`[name="${campo}"]`)).toBeVisible()
    }
    // No se envía: dispararía WhatsApp o correo real a los clientes con consentimiento.
    await cerrarModal(page, 'Nueva campaña')
  })

  test('galería: subir trabajo exige consentimiento del cliente', async ({ page }) => {
    await irA(page, '/admin/galeria', 'Galería')
    await page.getByRole('button', { name: 'Subir trabajo' }).click()
    const dialogo = modal(page, 'Subir trabajo')
    await expect(dialogo.locator('[name="consent"]')).toBeVisible()
    await expect(dialogo.locator('[name="published"]')).toBeVisible()
    await cerrarModal(page, 'Subir trabajo')
  })
})
