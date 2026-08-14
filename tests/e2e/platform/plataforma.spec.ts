import { test, expect } from '@playwright/test'
import { ROLE_PAGES, irA, watchErrors } from '../../support/pages'

test.describe('Plataforma (super admin)', () => {
  for (const { path, heading } of ROLE_PAGES.platform) {
    test(`carga ${path} sin errores`, async ({ page }) => {
      const vigilante = watchErrors(page)
      await irA(page, path, heading)
      expect(vigilante.errors, `errores en ${path}`).toEqual([])
    })
  }

  test('el menú lateral lleva a cada sección', async ({ page }) => {
    await irA(page, '/plataforma', 'Resumen de plataforma')
    const menu = page.getByRole('navigation')
    for (const nombre of ['Negocios', 'Planes y complementos', 'Invitaciones', 'Monitor', 'Claves de plataforma']) {
      await menu.getByRole('link', { name: nombre }).click()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })

  test('el resumen muestra las tarjetas de salud del SaaS', async ({ page }) => {
    await irA(page, '/plataforma', 'Resumen de plataforma')
    for (const tarjeta of ['Negocios activos', 'Profesionales activos', 'MRR estimado', 'Salud']) {
      await expect(page.getByText(tarjeta, { exact: true })).toBeVisible({ timeout: 60000 })
    }
  })

  test('negocios: lista los tenants y ofrece acciones de administración', async ({ page }) => {
    await irA(page, '/plataforma/negocios', 'Negocios')
    await expect(page.getByRole('button', { name: 'Nuevo negocio' })).toBeVisible()

    // Hay que esperar a que llegue la lista: las acciones viven dentro de cada fila.
    const filas = page.locator('main table tbody tr')
    await expect.poll(() => filas.count(), { timeout: 60000 }).toBeGreaterThan(0)
    await expect(page.getByText('estetica-bella-vida')).toBeVisible({ timeout: 60000 })

    // Suspender y Eliminar existen pero NO se ejecutan: son acciones destructivas sobre un tenant.
    await expect(page.getByRole('button', { name: /Suspender|Reactivar/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Eliminar' }).first()).toBeVisible()
  })

  test('negocios: el modal de alta pide los datos mínimos y no crea nada vacío', async ({ page }) => {
    await irA(page, '/plataforma/negocios', 'Negocios')
    await page.getByRole('button', { name: 'Nuevo negocio' }).click()

    const nombre = page.locator('input[name="name"]')
    const correo = page.locator('input[name="ownerEmail"]')
    await expect(nombre).toBeVisible()
    await expect(correo).toBeVisible()
    await expect(page.locator('input[name="timezone"]')).toHaveValue('America/Santiago')
    await expect(page.locator('input[name="currency"]')).toHaveValue('CLP')

    // Enviar vacío: la validación del navegador lo detiene y no se llama a la API.
    let llamadas = 0
    page.on('request', (r) => { if (r.url().includes('/api/platform/businesses') && r.method() === 'POST') llamadas++ })
    await page.getByRole('button', { name: 'Crear negocio' }).click()
    await expect(nombre).toHaveJSProperty('validity.valid', false)
    expect(llamadas, 'no debe intentar crear un negocio sin datos').toBe(0)
  })

  test('planes: se puede abrir el alta de plan', async ({ page }) => {
    await irA(page, '/plataforma/planes', 'Planes y complementos')
    await page.getByRole('button', { name: 'Nuevo plan' }).click()
    await expect(page.locator('input[name="code"]')).toBeVisible({ timeout: 60000 })
    await expect(page.locator('input[name="price"]')).toBeVisible()
  })

  test('monitor: muestra el estado de los servicios', async ({ page }) => {
    await irA(page, '/plataforma/monitor', 'Monitor')
    await expect(page.getByRole('button', { name: 'Re-verificar' })).toBeVisible({ timeout: 60000 })
    await expect(page.getByText(/Supabase/i).first()).toBeVisible({ timeout: 60000 })
  })

  test('claves: ninguna credencial guardada llega al navegador', async ({ page }) => {
    const respuesta = page.waitForResponse((r) => r.url().includes('/api/platform/settings') && r.request().method() === 'GET')
    await irA(page, '/plataforma/claves', 'Claves de plataforma')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 60000 })

    // Ni en los campos…
    for (const campo of await page.locator('main input[type="password"], main input[type="text"]').all()) {
      const valor = await campo.inputValue()
      expect(valor.startsWith('sk-'), 'una clave real no debe llegar al navegador').toBe(false)
      expect(valor.startsWith('re_'), 'una clave real no debe llegar al navegador').toBe(false)
    }

    // …ni en la respuesta de la API, que es por donde se escapaban antes.
    const cuerpo = await (await respuesta).text()
    expect(cuerpo).not.toContain('sk-')
    expect(cuerpo).not.toContain('re_')
  })

  test('claves: guardar avisa mientras trabaja y confirma el resultado', async ({ page }) => {
    await irA(page, '/plataforma/claves', 'Claves de plataforma')
    const guardar = page.getByRole('button', { name: 'Guardar' })
    await expect(guardar).toBeVisible({ timeout: 60000 })

    // Sin tocar nada no hay cambios que enviar: el servidor lo dice y la pantalla lo muestra.
    // No se escribe ninguna credencial en esta prueba.
    await guardar.click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 30000 })
    await expect(guardar).toBeEnabled()
  })

  test('claves: las credenciales se piden como contraseña, no en claro', async ({ page }) => {
    await irA(page, '/plataforma/claves', 'Claves de plataforma')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 60000 })
    // Las cuatro credenciales (OpenAI, DashScope, Evolution, Resend) van como password.
    await expect(page.locator('main input[type="password"]')).toHaveCount(4)
  })
})
