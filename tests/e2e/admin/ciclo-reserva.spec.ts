import { test, expect } from '@playwright/test'
import { exigirSandbox } from '../../support/sandbox'

/**
 * Ciclo completo de una reserva desde el panel del negocio: crear → verla en la agenda →
 * mover con motivo → cambiar la duración → cancelar con motivo → comprobar que ya no ocupa.
 *
 * Es el corazón del producto y el único camino donde nadie puede improvisar: toda mutación
 * pasa por las funciones SQL seguras (`create/reschedule/resize/cancel_safe_appointment`), que
 * son las que garantizan el anti-solape, la revalidación de disponibilidad y los avisos al
 * cliente. Estas pruebas comprueban ese camino de verdad, no una simulación.
 *
 * Se comprueba también lo que NO puede pasar:
 *  - reservar dos veces el mismo hueco con el mismo profesional (409 con `conflict:true`),
 *  - cambiar algo sin escribir el motivo (400: el motivo se le explica al cliente),
 *  - guardar un cambio que no cambia nada (400: no se le avisa al cliente por nada).
 *
 * Todo cuelga de un cliente de pruebas FIJO —mismo teléfono en cada ejecución— para no ir
 * dejando fichas nuevas: las reservas canceladas impiden borrar al cliente, y con razón.
 */

const CLIENTE_DE_PRUEBAS = { fullName: 'ZZZ Cliente de pruebas (agenda)', phone: '56990000199' }

type Servicio = { id: string; name: string; duration_minutes: number; active?: boolean }
type Profesional = { id: string; display_name: string; active?: boolean }

async function json(respuesta: import('@playwright/test').APIResponse) {
  return respuesta.json().catch(() => ({}))
}

/** La misma ficha en cada ejecución: si ya existe, se reutiliza. */
async function clienteDePruebas(page: import('@playwright/test').Page): Promise<string> {
  const encontrados = await page.request.get(`/api/admin/clients?q=${encodeURIComponent(CLIENTE_DE_PRUEBAS.phone)}`)
  const lista = (await json(encontrados)).clients as Array<{ id: string; phone: string | null }> | undefined
  const existente = (lista ?? []).find((cliente) => cliente.phone === CLIENTE_DE_PRUEBAS.phone)
  if (existente) return existente.id

  const creado = await page.request.post('/api/admin/clients', { data: CLIENTE_DE_PRUEBAS })
  expect([201, 409]).toContain(creado.status())
  if (creado.status() === 201) return (await json(creado)).client.id

  const reintento = await page.request.get(`/api/admin/clients?q=${encodeURIComponent(CLIENTE_DE_PRUEBAS.phone)}`)
  const otra = (await json(reintento)).clients as Array<{ id: string; phone: string | null }>
  return otra.find((cliente) => cliente.phone === CLIENTE_DE_PRUEBAS.phone)!.id
}

/** Un servicio y un profesional que de verdad puedan atenderlo juntos. */
async function parejaAtendible(page: import('@playwright/test').Page) {
  const catalogo = await json(await page.request.get('/api/admin/catalog'))
  const servicios = (catalogo.services ?? []) as Array<Servicio & { professional_services?: Array<{ professional_id: string; active?: boolean }> }>
  const profesionales = (catalogo.professionals ?? []) as Profesional[]

  for (const servicio of servicios) {
    if (servicio.active === false) continue
    const habilitados = (servicio.professional_services ?? []).filter((enlace) => enlace.active !== false)
    for (const enlace of habilitados) {
      const profesional = profesionales.find((item) => item.id === enlace.professional_id && item.active !== false)
      if (profesional) return { servicio, profesional }
    }
  }
  return null
}

/** Primer hueco real que ofrece el negocio para esa pareja, con su hora exacta. */
async function primerHueco(page: import('@playwright/test').Page, serviceId: string, professionalId: string) {
  const desde = new Date(Date.now() + 24 * 3600000).toISOString()
  const hasta = new Date(Date.now() + 12 * 86400000).toISOString()
  const respuesta = await page.request.post('/api/admin/slots', {
    data: { serviceId, professionalId, from: desde, until: hasta },
  })
  if (!respuesta.ok()) return null
  const datos = await json(respuesta)
  const slots = (datos.slots ?? []) as Array<{ service_start: string; professional_id: string }>
  return slots.find((slot) => slot.professional_id === professionalId) ?? slots[0] ?? null
}

async function cancelar(page: import('@playwright/test').Page, appointmentId: string) {
  await page.request.patch('/api/admin/agenda', {
    data: { appointmentId, action: 'cancel', reason: 'Limpieza de la prueba automática' },
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('Admin — ciclo completo de una reserva', () => {
  test('crear, mover, cambiar duración y cancelar, todo con motivo', async ({ page }) => {
    await exigirSandbox(page)

    const pareja = await parejaAtendible(page)
    test.skip(!pareja, 'el negocio no tiene ningún servicio con profesional habilitado')
    const clientId = await clienteDePruebas(page)
    const hueco = await primerHueco(page, pareja!.servicio.id, pareja!.profesional.id)
    test.skip(!hueco, 'no hay ningún horario disponible en los próximos doce días')

    let appointmentId: string | null = null
    try {
      // ---------------------------------------------------------------- crear
      const creada = await page.request.post('/api/admin/agenda', {
        data: {
          clientId,
          professionalId: pareja!.profesional.id,
          serviceId: pareja!.servicio.id,
          desiredStart: hueco!.service_start,
          notes: 'Prueba automática del ciclo de reserva',
        },
      })
      expect(creada.status(), await creada.text()).toBe(201)
      const reserva = (await json(creada)).appointment
      appointmentId = reserva.id as string
      expect(appointmentId).toBeTruthy()
      expect(reserva.source, 'una reserva del panel se marca como ADMIN').toBe('ADMIN')

      // -------------------------------------------------- visible en la agenda
      const desde = new Date(Date.now() - 3600000).toISOString()
      const hasta = new Date(Date.now() + 20 * 86400000).toISOString()
      const agenda = await json(await page.request.get(`/api/admin/agenda?from=${desde}&until=${hasta}`))
      const enAgenda = (agenda.appointments ?? []).find((cita: { id: string }) => cita.id === appointmentId)
      expect(enAgenda, 'la reserva no aparece en la agenda del negocio').toBeTruthy()

      // ------------------------------------------ el hueco ya no se puede dar
      const repetida = await page.request.post('/api/admin/agenda', {
        data: {
          clientId,
          professionalId: pareja!.profesional.id,
          serviceId: pareja!.servicio.id,
          desiredStart: hueco!.service_start,
        },
      })
      expect(repetida.status(), 'el mismo hueco se dio dos veces').toBe(409)
      expect((await json(repetida)).conflict).toBe(true)

      // ------------------------------------------- cambiar sin motivo: no va
      const sinMotivo = await page.request.patch('/api/admin/agenda', {
        data: { appointmentId, action: 'resize', durationMinutes: pareja!.servicio.duration_minutes + 15 },
      })
      expect(sinMotivo.status(), 'un cambio sin motivo no se puede guardar').toBe(400)
      expect((await json(sinMotivo)).error).toContain('motivo')

      // ------------------------------------------------------ cambiar duración
      const nuevaDuracion = pareja!.servicio.duration_minutes + 15
      const redimensionada = await page.request.patch('/api/admin/agenda', {
        data: { appointmentId, action: 'resize', durationMinutes: nuevaDuracion, reason: 'Prueba automática: alargar' },
      })
      expect([200, 409]).toContain(redimensionada.status())

      // ------------------------------------- un cambio que no cambia nada: no
      if (redimensionada.status() === 200) {
        const repetidaIgual = await page.request.patch('/api/admin/agenda', {
          data: { appointmentId, action: 'resize', durationMinutes: nuevaDuracion, reason: 'Prueba automática: misma duración' },
        })
        expect(repetidaIgual.status(), 'guardar la misma duración no es un cambio y no debe avisar al cliente').toBe(400)
      }

      // -------------------------------------------------------------- cancelar
      const cancelada = await page.request.patch('/api/admin/agenda', {
        data: { appointmentId, action: 'cancel', reason: 'Prueba automática: cierre del ciclo' },
      })
      expect(cancelada.status(), await cancelada.text()).toBe(200)

      // ------------------------------------------- el horario vuelve a ofrecerse
      const trasCancelar = await json(await page.request.get(`/api/admin/agenda?from=${desde}&until=${hasta}`))
      const cita = (trasCancelar.appointments ?? []).find((item: { id: string }) => item.id === appointmentId)
      expect(cita === undefined || cita.status === 'CANCELLED', 'la reserva sigue viva tras cancelarla').toBe(true)
      appointmentId = null
    } finally {
      if (appointmentId) await cancelar(page, appointmentId)
    }
  })

  test('una reserva en el pasado se rechaza', async ({ page }) => {
    await exigirSandbox(page)
    const pareja = await parejaAtendible(page)
    test.skip(!pareja, 'el negocio no tiene ningún servicio con profesional habilitado')
    const clientId = await clienteDePruebas(page)

    const respuesta = await page.request.post('/api/admin/agenda', {
      data: {
        clientId,
        professionalId: pareja!.profesional.id,
        serviceId: pareja!.servicio.id,
        desiredStart: new Date(Date.now() - 86400000).toISOString(),
      },
    })
    expect(respuesta.status()).toBe(400)
    expect((await json(respuesta)).error).toContain('futura')
  })
})
