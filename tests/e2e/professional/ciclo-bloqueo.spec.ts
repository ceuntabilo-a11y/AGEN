import { test, expect } from '@playwright/test'
import { irA, modal } from '../../support/pages'
import { exigirSandbox } from '../../support/sandbox'

/**
 * Bloquear un rato desde la agenda y verlo aparecer, como lo hace un profesional.
 *
 * Es la única acción de escritura que la agenda ofrece directamente, y la que más se usa: el
 * profesional se va antes, tiene una capacitación, o simplemente no quiere que le pongan
 * clientes a esa hora. Que "se guarde" no basta: tiene que **verse en el calendario sin
 * recargar**, seguir ahí después de recargar, y desaparecer al quitarlo.
 *
 * Escribe de verdad, así que exige el sandbox declarado y quita lo suyo pase lo que pase.
 */

async function json(respuesta: import('@playwright/test').APIResponse) {
  return respuesta.json().catch(() => ({}))
}

test.describe.configure({ mode: 'serial' })

test.describe('Profesional — bloquear un horario y verlo', () => {
  test('desde el formulario: se guarda, se ve en el calendario y sobrevive a recargar', async ({ page }) => {
    await exigirSandbox(page)
    const motivo = `ZZZ prueba automática ${Date.now()}`
    let id: string | null = null

    try {
      await irA(page, '/profesional/agenda', 'Mi agenda')
      await page.getByRole('button', { name: 'Bloquear horario' }).click()
      const dialogo = modal(page, 'Bloquear horario')

      /*
       * Hoy y tarde, a propósito. Tiene que caer dentro de la semana que el calendario está
       * mostrando —si no, el bloqueo se guarda pero no se ve, y la prueba fallaría por mirar
       * donde no es— y fuera de la jornada, para no chocar con ninguna reserva real.
       */
      const dia = await page.evaluate(() => new Date().toISOString().slice(0, 10))
      await dialogo.locator('[name="from"]').fill(`${dia}T23:00`)
      await dialogo.locator('[name="until"]').fill(`${dia}T23:45`)
      await dialogo.locator('[name="reason"]').fill(motivo)
      await dialogo.getByRole('button', { name: 'Bloquear horario' }).click()

      // Lo que ve la persona: aparece sin recargar nada.
      await expect(page.getByText(motivo).first()).toBeVisible({ timeout: 30000 })

      const agenda = await json(await page.request.get(
        `/api/professional/agenda?from=${new Date(Date.now() - 3600000).toISOString()}&until=${new Date(Date.now() + 10 * 86400000).toISOString()}`,
      ))
      const guardado = (agenda.blocks ?? []).find((b: { reason?: string }) => b.reason === motivo)
      expect(guardado, 'el bloqueo no quedó en la base').toBeTruthy()
      id = guardado.id

      await page.reload()
      await expect(page.getByText(motivo).first()).toBeVisible({ timeout: 30000 })

      // Y al quitarlo, el horario vuelve a quedar libre.
      const quitado = await page.request.delete(`/api/professional/blocks?id=${id}`)
      expect(quitado.ok(), await quitado.text()).toBe(true)
      id = null

      await page.reload()
      await expect(page.getByText(motivo)).toHaveCount(0, { timeout: 30000 })
    } finally {
      if (id) await page.request.delete(`/api/professional/blocks?id=${id}`)
    }
  })

  test('un horario al revés no se guarda y lo dice en pantalla', async ({ page }) => {
    await exigirSandbox(page)
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: 'Bloquear horario' }).click()
    const dialogo = modal(page, 'Bloquear horario')

    const dia = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    await dialogo.locator('[name="from"]').fill(`${dia}T10:00`)
    await dialogo.locator('[name="until"]').fill(`${dia}T09:00`)
    await dialogo.getByRole('button', { name: 'Bloquear horario' }).click()

    // El error se ve, y el modal no se cierra dejando pensar que se guardó.
    await expect(dialogo.getByRole('alert')).toBeVisible()
    await expect(dialogo.getByText(/posterior/)).toBeVisible()
  })

  test('el bloqueo de otro profesional no se puede quitar', async ({ page }) => {
    await exigirSandbox(page)
    const respuesta = await page.request.delete('/api/professional/blocks?id=00000000-0000-0000-0000-000000000000')
    expect(respuesta.status()).toBe(404)
  })
})
