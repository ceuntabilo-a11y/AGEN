import { test, expect } from '@playwright/test'
import { cerrarModal, irA, modal } from '../../support/pages'

test.describe('Admin — servicios y equipo', () => {
  test('servicios: la tabla lista el catálogo del negocio', async ({ page }) => {
    await irA(page, '/admin/servicios', 'Servicios')
    const filas = page.locator('main table tbody tr')
    await expect.poll(() => filas.count(), { timeout: 60000 }).toBeGreaterThan(0)
    await expect(page.getByRole('columnheader', { name: 'SERVICIO' })).toBeVisible()
    await expect(page.getByText('Aún no hay servicios.')).toBeHidden()
  })

  // Regresión: antes el estado vacío se pintaba mientras la consulta seguía en curso, así que
  // el negocio parecía no tener nada durante varios segundos.
  for (const [ruta, vacio] of [
    ['/admin/servicios', 'Aún no hay servicios.'],
    ['/admin/equipo', 'Aún no hay profesionales.'],
  ] as const) {
    test(`${ruta} no muestra el estado vacío mientras carga`, async ({ page }) => {
      await page.goto(ruta, { waitUntil: 'domcontentloaded' })
      const textoVacio = page.getByText(vacio, { exact: true })

      // Se vigila desde el primer instante hasta que llegan los datos.
      const hasta = Date.now() + 60000
      let conDatos = false
      while (Date.now() < hasta) {
        expect(await textoVacio.count(), `"${vacio}" no debe aparecer nunca: el negocio sí tiene datos`).toBe(0)
        if (await page.locator('main table tbody tr, main article').count() > 0) { conDatos = true; break }
        await page.waitForTimeout(100)
      }
      expect(conDatos, 'los datos deberían haber llegado').toBe(true)
    })
  }

  test('servicios: el modal de alta trae los campos de duración, precio y buffer', async ({ page }) => {
    await irA(page, '/admin/servicios', 'Servicios')
    await page.getByRole('button', { name: 'Nuevo servicio' }).click()

    const dialogo = modal(page, 'Nuevo servicio')
    for (const campo of ['name', 'specialtyId', 'duration', 'buffer', 'price', 'cost']) {
      await expect(dialogo.locator(`[name="${campo}"]`)).toBeVisible()
    }
    // Se cierra sin guardar: la prueba no debe dejar datos.
    await cerrarModal(page, 'Nuevo servicio')
  })

  test('equipo: lista los profesionales del negocio', async ({ page }) => {
    await irA(page, '/admin/equipo', 'Equipo')
    await expect.poll(() => page.locator('main article').count(), { timeout: 60000 }).toBeGreaterThan(0)
    await expect(page.getByText('Aún no hay profesionales.')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Agregar profesional' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Agregar especialidad' })).toBeVisible()
  })

  test('equipo: el alta de profesional pide nombre y contacto', async ({ page }) => {
    await irA(page, '/admin/equipo', 'Equipo')
    await page.getByRole('button', { name: 'Agregar profesional' }).click()
    const dialogo = modal(page, 'Nuevo profesional')
    await expect(dialogo.locator('[name="displayName"]')).toBeVisible()
    await expect(dialogo.locator('[name="email"]')).toBeVisible()
    await cerrarModal(page, 'Nuevo profesional')
  })

  test('clientes: el buscador filtra sobre la API y el alta pide nombre', async ({ page }) => {
    await irA(page, '/admin/clientes', 'Clientes')
    const buscador = page.getByPlaceholder('Buscar por nombre o teléfono')
    await expect(buscador).toBeVisible()

    const consulta = page.waitForRequest((r) => r.url().includes('/api/admin/clients?q=') && r.url().includes('zzz'))
    await buscador.fill('zzz-no-existe')
    await consulta

    await page.getByRole('button', { name: 'Nuevo cliente' }).click()
    const dialogo = modal(page, 'Nuevo cliente')
    await expect(dialogo.locator('[name="fullName"]')).toBeVisible()
    await expect(dialogo.locator('[name="phone"]')).toBeVisible()
    await cerrarModal(page, 'Nuevo cliente')
  })
})
