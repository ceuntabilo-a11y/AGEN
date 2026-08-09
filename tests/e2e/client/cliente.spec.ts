import { test, expect } from '@playwright/test'
import { ROLE_PAGES, irA, watchErrors } from '../../support/pages'

test.describe('Cliente', () => {
  for (const { path, heading } of ROLE_PAGES.client) {
    test(`carga ${path} sin errores`, async ({ page }) => {
      const vigilante = watchErrors(page)
      await irA(page, path, heading)
      expect(vigilante.errors, `errores en ${path}`).toEqual([])
    })
  }

  test('el portal solo ofrece servicios del negocio', async ({ page }) => {
    await irA(page, '/cliente/reservar', 'Reservar')
    await expect(page.getByText('1. Elige el servicio')).toBeVisible()
    await expect.poll(() => page.getByRole('button', { name: /· \d+ min · \$/ }).count(), { timeout: 30000 }).toBeGreaterThan(0)
  })

  test('al elegir servicio solo aparecen profesionales autorizados', async ({ page }) => {
    await irA(page, '/cliente/reservar', 'Reservar')
    await page.getByRole('button', { name: /^Corte y Peinado/ }).click()
    await expect(page.getByText('2. Elige profesional')).toBeVisible()
    await expect(page.getByText(/Solo profesionales habilitados para Corte y Peinado/)).toBeVisible()
    // professional_services es la lista autorizada: no puede ofrecer a todo el equipo.
    const equipo = await page.getByRole('button', { name: /^[A-ZÁÉÍÓÚÑ]{2}[A-Za-zÁ-úñ ]+$/ }).count()
    expect(equipo).toBeGreaterThan(0)
  })

  test('un día abierto devuelve horas y arma el resumen sin reservar', async ({ page }) => {
    await irA(page, '/cliente/reservar', 'Reservar')
    await page.getByRole('button', { name: /^Corte y Peinado/ }).click()
    await page.getByRole('button', { name: /Camila Rojas|Valentina Soto/ }).first().click()

    // Lunes: el negocio abre de 09:00 a 19:00 (settings.business_hours day 1).
    await page.locator('input[type="date"]').fill('2026-08-10')
    await page.getByRole('button', { name: 'Ver horas' }).click()

    const horas = page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ })
    await expect.poll(() => horas.count(), { timeout: 30000 }).toBeGreaterThan(0)

    await horas.first().click()
    await expect(page.getByText('Por elegir')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toBeVisible()
    // Deliberadamente no se confirma: crearía una cita real vía create_safe_appointment.
  })

  /**
   * Una lista de horas vacía tiene tres causas distintas y el cliente necesita saber cuál es.
   * Antes las tres mostraban el mismo texto neutro.
   */
  test.describe('por qué no hay horas', () => {
    const elegirServicioYProfesional = async (page: import('@playwright/test').Page) => {
      await irA(page, '/cliente/reservar', 'Reservar')
      await page.getByRole('button', { name: /^Corte y Peinado/ }).click()
      await page.getByRole('button', { name: /Camila Rojas/ }).first().click()
    }
    const paso3 = (page: import('@playwright/test').Page) =>
      page.locator('section').filter({ hasText: '3. Elige fecha y hora' })

    test('domingo: avisa que el negocio no atiende', async ({ page }) => {
      await elegirServicioYProfesional(page)
      // 2026-08-09 es domingo y el negocio cierra (settings.business_hours day 7 enabled=false).
      await page.locator('input[type="date"]').fill('2026-08-09')
      await page.getByRole('button', { name: 'Ver horas' }).click()
      await expect(paso3(page).getByText(/el negocio no atiende/i)).toBeVisible()
    })

    test('si falla la consulta lo dice, en vez de parecer que no hay horas', async ({ page }) => {
      await elegirServicioYProfesional(page)
      await page.route('**/api/client/slots', (route) => route.abort())
      await page.locator('input[type="date"]').fill('2026-08-11')
      await page.getByRole('button', { name: 'Ver horas' }).click()
      await expect(paso3(page).getByRole('alert')).toContainText(/No pudimos consultar/i)
    })

    test('profesional que no trabaja ese día vs día sin cupo', async ({ page }) => {
      await elegirServicioYProfesional(page)

      // El profesional elegido no trabaja ese día, pero el negocio sí abre.
      await page.route('**/api/client/slots', async (route) => {
        const original = await route.fetch()
        const datos = await original.json()
        const cobertura = (datos.coverage ?? []).map((item: { works: boolean }, indice: number) => ({ ...item, works: indice !== 0 }))
        await route.fulfill({ json: { ...datos, slots: [], dayOff: false, coverage: cobertura } })
      })
      await page.locator('input[type="date"]').fill('2026-08-12')
      await page.getByRole('button', { name: 'Ver horas' }).click()
      await expect(paso3(page).getByText(/no atiende ese día/i)).toBeVisible()

      // Trabaja, pero la agenda de ese día está llena.
      await page.unroute('**/api/client/slots')
      await page.route('**/api/client/slots', async (route) => {
        const original = await route.fetch()
        const datos = await original.json()
        const cobertura = (datos.coverage ?? []).map((item: object) => ({ ...item, works: true }))
        await route.fulfill({ json: { ...datos, slots: [], dayOff: false, coverage: cobertura } })
      })
      await page.locator('input[type="date"]').fill('2026-08-13')
      await page.getByRole('button', { name: 'Ver horas' }).click()
      await expect(paso3(page).getByText(/No quedan horas libres/i)).toBeVisible()
    })
  })

  test('el perfil del cliente se puede editar', async ({ page }) => {
    await irA(page, '/cliente/perfil', 'Mi perfil')
    await expect(page.locator('[name="fullName"]')).toBeVisible()
    await expect(page.locator('[name="phone"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeVisible()
  })

  test('el cliente no accede al panel de administración', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/cliente/)
  })

  test('el cliente no accede al panel del profesional', async ({ page }) => {
    await page.goto('/profesional')
    await expect(page).toHaveURL(/\/cliente/)
  })

  test('el cliente no accede al panel de plataforma', async ({ page }) => {
    await page.goto('/plataforma')
    await expect(page).toHaveURL(/\/cliente/)
  })
})
