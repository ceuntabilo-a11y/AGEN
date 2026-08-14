import { test, expect } from '@playwright/test'
import { irA } from '../../support/pages'

/**
 * Claves de plataforma: el flujo real de guardado, reproduciendo el bug que se vio en
 * producción.
 *
 * Lo que pasaba: guardar una sola credencial respondía "Listo: 3 guardada(s) y 1 quitada(s)"
 * **y al mismo tiempo** "No se pudo contactar al servidor". Dos fallos distintos:
 *
 *  1. `event.currentTarget.reset()` corría después de un `await`, y React ya había anulado
 *     `currentTarget`: el TypeError caía en el catch y pintaba el error encima del éxito.
 *  2. Los tres campos de texto se enviaban SIEMPRE, así que cada guardado reescribía o
 *     borraba filas que el administrador no había tocado. El "3 y 1" era literal.
 *
 * Estas pruebas usan el endpoint dedicado de DashScope como campo de trabajo —no es una
 * credencial— y restauran su valor original al terminar.
 */

type Secreto = { configurada: boolean; pista: string | null }

const leerSettings = async (page: import('@playwright/test').Page) => {
  const respuesta = await page.request.get('/api/platform/settings')
  expect(respuesta.ok()).toBe(true)
  return (await respuesta.json()).settings as Record<string, Secreto | string | null>
}

test.describe('Claves de plataforma — guardado real', () => {
  test('guardar un solo campo no toca ninguna otra fila', async ({ page }) => {
    const antes = await leerSettings(page)
    const original = antes.dashscope_fallback_endpoint as string | null

    try {
      const respuesta = await page.request.patch('/api/platform/settings', {
        data: { dashscope_fallback_endpoint: 'https://prueba-aislada.invalid/uno' },
      })
      expect(respuesta.ok()).toBe(true)
      const datos = await respuesta.json() as { guardadas: string[]; quitadas: string[] }

      // Exactamente una fila tocada. Este era el bug: informaba 3 guardadas y 1 quitada.
      expect(datos.guardadas).toEqual(['dashscope_fallback_endpoint'])
      expect(datos.quitadas).toEqual([])

      // Y las demás siguen exactamente como estaban.
      const despues = await leerSettings(page)
      for (const clave of ['openai_fallback_key', 'dashscope_fallback_key', 'evolution_api_key', 'resend_api_key']) {
        expect((despues[clave] as Secreto).configurada, clave).toBe((antes[clave] as Secreto).configurada)
      }
      for (const clave of ['evolution_api_url', 'resend_from']) {
        expect(despues[clave], clave).toBe(antes[clave])
      }
    } finally {
      await page.request.patch('/api/platform/settings', { data: { dashscope_fallback_endpoint: original ?? '' } })
    }
  })

  test('lo guardado sigue ahí después de recargar', async ({ page }) => {
    const antes = await leerSettings(page)
    const original = antes.dashscope_fallback_endpoint as string | null
    const marca = `https://prueba-persistencia.invalid/${Date.now()}`

    try {
      await page.request.patch('/api/platform/settings', { data: { dashscope_fallback_endpoint: marca } })
      await irA(page, '/plataforma/claves', 'Claves de plataforma')
      await expect(page.locator('input[name="dashscope_fallback_endpoint"]')).toHaveValue(marca, { timeout: 30000 })

      await page.reload()
      await expect(page.locator('input[name="dashscope_fallback_endpoint"]')).toHaveValue(marca, { timeout: 30000 })
    } finally {
      await page.request.patch('/api/platform/settings', { data: { dashscope_fallback_endpoint: original ?? '' } })
    }
  })

  test('éxito y error nunca aparecen a la vez', async ({ page }) => {
    const antes = await leerSettings(page)
    const original = antes.dashscope_fallback_endpoint as string | null

    try {
      await irA(page, '/plataforma/claves', 'Claves de plataforma')
      const campo = page.locator('input[name="dashscope_fallback_endpoint"]')
      await expect(campo).toBeVisible({ timeout: 30000 })
      await campo.fill('https://prueba-mensajes.invalid/dos')

      const guardar = page.getByRole('button', { name: 'Guardar' })
      await guardar.click()

      // El éxito aparece…
      await expect(page.locator('main').getByRole('status')).toContainText('Listo:', { timeout: 30000 })
      // …y el error NO. Este era el síntoma exacto que se vio en producción.
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
      // Una sola fila tocada, y se dice cuál.
      await expect(page.locator('main').getByRole('status')).toContainText('1 guardada(s)')
      await expect(page.locator('main').getByRole('status')).not.toContainText('quitada(s)')
    } finally {
      await page.request.patch('/api/platform/settings', { data: { dashscope_fallback_endpoint: original ?? '' } })
    }
  })

  test('el botón avisa mientras trabaja y se vuelve a habilitar', async ({ page }) => {
    const antes = await leerSettings(page)
    const original = antes.dashscope_fallback_endpoint as string | null

    try {
      await irA(page, '/plataforma/claves', 'Claves de plataforma')
      const campo = page.locator('input[name="dashscope_fallback_endpoint"]')
      await expect(campo).toBeVisible({ timeout: 30000 })
      await campo.fill('https://prueba-estado.invalid/tres')

      // La respuesta se retiene para poder ver el estado intermedio.
      await page.route('**/api/platform/settings', async (ruta) => {
        if (ruta.request().method() !== 'PATCH') return ruta.continue()
        await new Promise((listo) => setTimeout(listo, 1500))
        await ruta.continue()
      })

      const guardar = page.getByRole('button', { name: /Guardar/ })
      await guardar.click()
      await expect(page.getByRole('button', { name: 'Guardando…' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Guardar' })).toBeEnabled({ timeout: 30000 })
    } finally {
      await page.unroute('**/api/platform/settings')
      await page.request.patch('/api/platform/settings', { data: { dashscope_fallback_endpoint: original ?? '' } })
    }
  })

  test('sin cambios no se llama al servidor y se dice por qué', async ({ page }) => {
    await irA(page, '/plataforma/claves', 'Claves de plataforma')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 30000 })

    let llamadas = 0
    page.on('request', (peticion) => {
      if (peticion.url().includes('/api/platform/settings') && peticion.method() === 'PATCH') llamadas++
    })

    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.locator('main').getByRole('alert')).toContainText('No cambiaste nada', { timeout: 30000 })
    await expect(page.locator('main').getByRole('status')).toHaveCount(0)
    expect(llamadas, 'sin cambios no hay nada que pedirle al servidor').toBe(0)
  })

  test('un mensaje viejo desaparece al volver a editar', async ({ page }) => {
    await irA(page, '/plataforma/claves', 'Claves de plataforma')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible({ timeout: 30000 })

    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.locator('main').getByRole('alert')).toBeVisible({ timeout: 30000 })

    await page.locator('input[name="dashscope_fallback_endpoint"]').fill('https://algo.invalid')
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
  })
})
