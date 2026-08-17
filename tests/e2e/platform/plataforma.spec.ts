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

  test('el resumen muestra el estado comercial y operativo', async ({ page }) => {
    await irA(page, '/plataforma', 'Resumen de plataforma')
    // Los bloques que hacen falta para decidir una venta, no tarjetas decorativas.
    for (const bloque of ['Demos y conversión', 'Ingresos mensuales recurrentes estimados', 'Próximos a vencer', 'Operación']) {
      await expect(page.getByText(bloque, { exact: true }).first()).toBeVisible({ timeout: 60000 })
    }
    // Y «MRR» explicado en español: por sí solo no le dice nada a quien vende.
    await expect(page.getByText(/También llamado MRR/)).toBeVisible()
  })

  test('negocios: lista los tenants y ofrece acciones de administración', async ({ page }) => {
    await irA(page, '/plataforma/negocios', 'Negocios')
    await expect(page.getByRole('button', { name: 'Nuevo negocio' })).toBeVisible()

    // Hay que esperar a que llegue la lista: las acciones viven dentro de cada fila.
    const filas = page.locator('main table tbody tr')
    await expect.poll(() => filas.count(), { timeout: 60000 }).toBeGreaterThan(0)
    await expect(page.getByText(/estetica-bella-vida/).first()).toBeVisible({ timeout: 60000 })

    // Suspender y Eliminar existen pero NO se ejecutan: son acciones destructivas sobre un tenant.
    await expect(page.getByRole('button', { name: /Suspender|Reactivar/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Eliminar' }).first()).toBeVisible()
    // Editar y reenviar la invitación: las dos que faltaban para administrar sin borrar nada.
    await expect(page.getByRole('button', { name: 'Editar' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Reenviar invitación/ }).first()).toBeVisible()
  })

  test('negocios: el alta pide lo mínimo, resume antes de crear y no crea nada vacío', async ({ page }) => {
    await irA(page, '/plataforma/negocios', 'Negocios')
    await page.getByRole('button', { name: 'Nuevo negocio' }).click()

    const nombre = page.getByLabel('Nombre del negocio')
    const correo = page.getByLabel('Correo del dueño')
    await expect(nombre).toBeVisible()
    await expect(correo).toBeVisible()

    // Zona horaria y moneda son elegibles, con América/Santiago y CLP por defecto.
    await expect(page.getByLabel('Zona horaria')).toHaveValue('America/Santiago')
    await expect(page.getByLabel('Moneda')).toHaveValue('CLP')

    // Enviar vacío: la validación del navegador lo detiene y no se llama a la API.
    let llamadas = 0
    page.on('request', (r) => { if (r.url().includes('/api/platform/businesses') && r.method() === 'POST') llamadas++ })
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(nombre).toHaveJSProperty('validity.valid', false)
    expect(llamadas, 'no debe intentar crear un negocio sin datos').toBe(0)
  })

  test('negocios: la dirección web se genera sola y se puede revisar antes de crear', async ({ page }) => {
    await irA(page, '/plataforma/negocios', 'Negocios')
    await page.getByRole('button', { name: 'Nuevo negocio' }).click()

    // El administrador escribe el nombre; el slug sale solo, sin que tenga que saber qué es.
    await page.getByLabel('Nombre del negocio').fill('Peluquería Prueba Ñandú')
    await expect(page.getByText('peluqueria-prueba-nandu')).toBeVisible()

    await page.getByLabel('Correo del dueño').fill('nadie@prueba.invalid')

    // El resumen previo: se ve todo lo que se va a crear, y NO se ha llamado a la API todavía.
    let llamadas = 0
    page.on('request', (r) => { if (r.url().includes('/api/platform/businesses') && r.method() === 'POST') llamadas++ })
    await page.getByRole('button', { name: 'Revisar' }).click()
    await expect(page.getByRole('heading', { name: '¿Creamos este negocio?' })).toBeVisible()
    // `.first()`: el correo del dueño sale dos veces a propósito —en la frase que avisa de que
    // se le va a invitar y en la tabla del resumen—, así que sin acotar hay dos coincidencias.
    await expect(page.getByText('peluqueria-prueba-nandu').first()).toBeVisible()
    await expect(page.getByText('nadie@prueba.invalid').first()).toBeVisible()
    expect(llamadas, 'el resumen no puede crear nada por sí solo').toBe(0)

    // Se cancela: esta prueba no crea negocios reales.
    await page.getByRole('button', { name: 'Volver a editar' }).click()
    await expect(page.getByRole('heading', { name: 'Nuevo negocio' })).toBeVisible()
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
    // Acotado a `main`: Next inyecta su propio `role="alert"` (el anunciador de rutas) y sin
    // acotar el localizador coincide con dos elementos.
    await expect(page.locator('main').getByRole('alert')).toBeVisible({ timeout: 30000 })
    await expect(guardar).toBeEnabled()
  })

  test('claves: las credenciales se piden como contraseña, no en claro', async ({ page }) => {
    await irA(page, '/plataforma/claves', 'Claves de plataforma')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 60000 })
    // Las cuatro credenciales (OpenAI, DashScope, Evolution, Resend) van como password.
    await expect(page.locator('main input[type="password"]')).toHaveCount(4)
  })
})
