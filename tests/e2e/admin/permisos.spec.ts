import { test, expect } from '@playwright/test'

/**
 * El middleware vive en `src/middleware.ts` (no en la raíz): con el directorio `src`,
 * Next.js solo carga el middleware desde ahí. Estas pruebas cubren esa protección.
 */
test.describe('Admin — límites de acceso', () => {
  test('el dueño del negocio no entra al panel de plataforma', async ({ page }) => {
    await page.goto('/plataforma')
    await expect(page).toHaveURL(/\/admin/)
  })

  test('el dueño del negocio no entra al panel del profesional', async ({ page }) => {
    await page.goto('/profesional')
    await expect(page).toHaveURL(/\/admin/)
  })

  test('las APIs de plataforma rechazan a un dueño de negocio', async ({ request }) => {
    const respuesta = await request.get('/api/platform/businesses')
    expect([401, 403]).toContain(respuesta.status())
  })

  test('las APIs del agente exigen el secreto compartido', async ({ request }) => {
    // La sesión de navegador no debe alcanzar para operar como agente.
    const respuesta = await request.post('/api/agent/clients', { data: { phone: '+56900000000' } })
    expect(respuesta.status()).toBeGreaterThanOrEqual(400)
  })

  test('una visita anónima no ve ningún panel privado', async ({ browser }) => {
    const anonimo = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const pagina = await anonimo.newPage()
    for (const ruta of ['/admin', '/admin/clientes', '/profesional', '/cliente', '/plataforma']) {
      await pagina.goto(ruta)
      await expect(pagina, `${ruta} debe mandar a /login`).toHaveURL(/\/login/)
    }
    await anonimo.close()
  })
})
