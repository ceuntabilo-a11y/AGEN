import { test, expect } from '@playwright/test'
import { irA } from '../../support/pages'
import { exigirSandbox } from '../../support/sandbox'

/**
 * Bug real reportado por el dueño (2026-08-22): activar "Habilitar respuestas por voz" en la
 * pestaña Voz y guardar apagaba "Agente habilitado" (pestaña General) — y al revés. Cada
 * pestaña solo monta en el DOM sus propios campos, así que `new FormData(form)` del formulario
 * completo solo traía los de la pestaña visible; el resto volvía a sus valores por defecto en
 * cada guardado, sin que el dueño lo pidiera.
 *
 * Esta prueba SÍ guarda de verdad (hace falta para reproducir el bug), así que restaura la
 * configuración original al terminar — nunca deja el negocio real con datos de prueba.
 */
test.describe('Agente IA: guardar desde una pestaña no borra las otras', () => {
  test('guardar desde "Voz" conserva "Agente habilitado", el tono y el comportamiento', async ({ page }) => {
    await exigirSandbox(page)

    const original = await (await page.request.get('/api/admin/settings')).json()
    const original_agent_settings = original.business.agent_settings

    try {
      await irA(page, '/admin/agente', 'Agente IA')

      await page.getByRole('button', { name: 'General', exact: true }).click()
      const habilitado = page.getByLabel('Agente habilitado')
      await expect(habilitado).toBeVisible()
      // Se fuerza a un estado conocido para no depender de lo que hubiera antes.
      if (!(await habilitado.isChecked())) await habilitado.check()
      await page.getByRole('button', { name: 'Guardar configuración' }).click()
      await expect(page.getByText('Configuración guardada y aplicada al agente.')).toBeVisible({ timeout: 10000 })

      // Ahora se guarda desde OTRA pestaña — antes del arreglo, esto apagaba "Agente habilitado".
      await page.getByRole('button', { name: 'Voz', exact: true }).click()
      const vozHabilitada = page.getByLabel('Habilitar respuestas por voz')
      await vozHabilitada.check()
      await page.getByRole('button', { name: 'Guardar configuración' }).click()
      await expect(page.getByText('Configuración guardada y aplicada al agente.')).toBeVisible({ timeout: 10000 })

      await page.getByRole('button', { name: 'General', exact: true }).click()
      await expect(habilitado, '"Agente habilitado" no debería apagarse al guardar desde Voz').toBeChecked()

      // Comprobado también contra la base, no solo contra el DOM (que podría no haber recargado).
      const despues = await (await page.request.get('/api/admin/settings')).json()
      expect(despues.business.agent_settings.enabled, 'enabled debe seguir true en la base').toBe(true)
      expect(despues.business.agent_settings.voice?.enabled, 'voice.enabled debe haberse guardado').toBe(true)
      expect(despues.business.agent_settings.tone, 'el tono no debería cambiar al guardar desde Voz')
        .toBe(original_agent_settings?.tone ?? 'friendly')
    } finally {
      // Se restaura tal cual estaba, sea cual sea el resultado de la prueba.
      await page.request.patch('/api/admin/settings', { data: { agent_settings: original_agent_settings ?? {} } })
    }
  })
})
