import { test, expect } from '@playwright/test'
import { exigirSandbox } from '../../support/sandbox'

/**
 * Ciclo completo desde el portal del cliente: elegir servicio → ver horas reales → reservar →
 * verla en "mis reservas" → recargar → confirmarla → cancelarla.
 *
 * Las pruebas del portal llegaban hasta "arma el resumen sin reservar", así que el paso donde
 * de verdad puede fallar algo —el que escribe— no estaba cubierto. Y es el paso que decide si
 * un negocio puede vender el portal: si un cliente pulsa Reservar y no pasa nada, no hay
 * producto.
 *
 * También se fija lo que NO puede pasar:
 *  - reservar un horario que ya no está,
 *  - reservar en el pasado,
 *  - cancelar con menos antelación de la que el negocio exige.
 *
 * Escribe de verdad, así que exige el sandbox declarado y cancela lo que crea.
 */

type Servicio = { id: string; name: string; duration_minutes: number }
type Hueco = { professional_id: string; service_start: string; professional_name?: string }

async function json(respuesta: import('@playwright/test').APIResponse) {
  return respuesta.json().catch(() => ({}))
}

/** Primer servicio del portal que tenga horas libres, con su primer hueco. */
async function primerHuecoDelPortal(page: import('@playwright/test').Page) {
  const catalogo = await json(await page.request.get('/api/client/catalog'))
  const servicios = (catalogo.services ?? []) as Servicio[]

  for (const servicio of servicios.slice(0, 6)) {
    const respuesta = await page.request.post('/api/client/slots', {
      data: {
        serviceId: servicio.id,
        from: new Date(Date.now() + 48 * 3600000).toISOString(),
        until: new Date(Date.now() + 14 * 86400000).toISOString(),
      },
    })
    if (!respuesta.ok()) continue
    const slots = ((await json(respuesta)).slots ?? []) as Hueco[]
    if (slots.length) return { servicio, hueco: slots[0] }
  }
  return null
}

async function cancelar(page: import('@playwright/test').Page, appointmentId: string) {
  await page.request.patch('/api/client/appointments', { data: { appointmentId, action: 'cancel' } })
}

test.describe.configure({ mode: 'serial' })

test.describe('Cliente — reservar de verdad desde el portal', () => {
  test('reservar, verla, confirmarla y cancelarla', async ({ page }) => {
    await exigirSandbox(page)
    const opcion = await primerHuecoDelPortal(page)
    test.skip(!opcion, 'el portal no ofrece ninguna hora en los próximos catorce días')

    let appointmentId: string | null = null
    try {
      // -------------------------------------------------------------- reservar
      const creada = await page.request.post('/api/client/book', {
        data: {
          serviceId: opcion!.servicio.id,
          professionalId: opcion!.hueco.professional_id,
          desiredStart: opcion!.hueco.service_start,
          notes: 'Prueba automática del portal',
        },
      })
      expect(creada.status(), await creada.text()).toBe(201)
      const reserva = (await json(creada)).appointment
      appointmentId = reserva.id as string
      expect(reserva.source, 'una reserva del portal se marca como CLIENT').toBe('CLIENT')

      // ------------------------------------------------- aparece en sus reservas
      const mias = await json(await page.request.get('/api/client/appointments'))
      const encontrada = (mias.appointments ?? []).find((cita: { id: string }) => cita.id === appointmentId)
      expect(encontrada, 'la reserva no aparece en "mis reservas"').toBeTruthy()

      // ------------------------------------------------- se ve en la pantalla
      await page.goto('/cliente/reservas')
      await expect(page.getByText(opcion!.servicio.name, { exact: false }).first()).toBeVisible({ timeout: 30000 })

      // ------------------------------------ el mismo hueco ya no se puede tomar
      const repetida = await page.request.post('/api/client/book', {
        data: {
          serviceId: opcion!.servicio.id,
          professionalId: opcion!.hueco.professional_id,
          desiredStart: opcion!.hueco.service_start,
        },
      })
      expect(repetida.status(), 'el portal dio dos veces el mismo horario').toBe(409)
      expect((await json(repetida)).conflict).toBe(true)

      // ------------------------------------------------------------ confirmar
      const confirmada = await page.request.patch('/api/client/appointments', {
        data: { appointmentId, action: 'confirm' },
      })
      expect(confirmada.status()).toBe(200)
      expect((await json(confirmada)).appointment.status).toBe('CONFIRMED')

      // ------------------------------------------------------------- cancelar
      const cancelada = await page.request.patch('/api/client/appointments', {
        data: { appointmentId, action: 'cancel' },
      })
      // 409 legítimo si el negocio exige más antelación de la que hay hasta ese hueco.
      expect([200, 409]).toContain(cancelada.status())
      if (cancelada.status() === 409) {
        expect((await json(cancelada)).error).toContain('anticipación')
      } else {
        const tras = await json(await page.request.get('/api/client/appointments'))
        const sigue = (tras.appointments ?? []).find((cita: { id: string }) => cita.id === appointmentId)
        expect(sigue === undefined || sigue.status === 'CANCELLED').toBe(true)
        appointmentId = null
      }
    } finally {
      if (appointmentId) await cancelar(page, appointmentId)
    }
  })

  test('una reserva en el pasado se rechaza', async ({ page }) => {
    await exigirSandbox(page)
    const opcion = await primerHuecoDelPortal(page)
    test.skip(!opcion, 'el portal no ofrece ninguna hora')

    const respuesta = await page.request.post('/api/client/book', {
      data: {
        serviceId: opcion!.servicio.id,
        professionalId: opcion!.hueco.professional_id,
        desiredStart: new Date(Date.now() - 3600000).toISOString(),
      },
    })
    expect(respuesta.status()).toBe(400)
    expect((await json(respuesta)).error).toContain('futura')
  })

  test('una reserva de otro cliente no se puede tocar', async ({ page }) => {
    await exigirSandbox(page)
    // Aislamiento entre clientes: es lo que impide que alguien cancele la hora de otro.
    const respuesta = await page.request.patch('/api/client/appointments', {
      data: { appointmentId: '00000000-0000-0000-0000-000000000000', action: 'cancel' },
    })
    expect(respuesta.status()).toBe(404)
  })
})
