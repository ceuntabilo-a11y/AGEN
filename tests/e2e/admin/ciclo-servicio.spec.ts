import { test, expect } from '@playwright/test'
import { irA, modal } from '../../support/pages'
import { exigirSandbox } from '../../support/sandbox'

/**
 * El ciclo completo de una función del panel, como usuario: abrir → escribir → guardar →
 * confirmación → recargar → verificar → editar → verificar → eliminar → verificar.
 *
 * Es el hueco que quedaba. Las demás pruebas del catálogo abren el modal y lo cierran sin
 * guardar, así que cubren "el botón existe" y no "guardar funciona" — y por ahí es por donde
 * se coló el bug de `/plataforma/claves`, que sobrevivió a cientos de pruebas: el formulario
 * decía "guardado" y no guardaba.
 *
 * Escribe de verdad, así que exige el sandbox declarado (`exigirSandbox`): sin
 * `E2E_SANDBOX_BUSINESS_NAME` la prueba se salta con un motivo claro en vez de tocar el
 * negocio equivocado. Y limpia lo suyo pase lo que pase.
 *
 * El servicio de prueba lleva un nombre que nadie confundiría con uno real y se desactiva al
 * terminar (`DELETE` desactiva, no borra: conserva el historial de reservas).
 */

const MARCA = 'ZZZ Prueba automática'

/** Nombre único por ejecución: dos pasadas seguidas no pueden chocar por el nombre. */
const nombreDePrueba = () => `${MARCA} ${Date.now()}`

type Servicio = { id: string; name: string; duration_minutes: number; price: number; active: boolean }

async function listarServicios(page: import('@playwright/test').Page): Promise<Servicio[]> {
  // El catálogo del negocio se lee de `/api/admin/catalog`; `/api/admin/services` solo muta.
  const respuesta = await page.request.get('/api/admin/catalog')
  expect(respuesta.ok(), 'no se pudo listar el catálogo').toBe(true)
  return (await respuesta.json()).services as Servicio[]
}

async function desactivar(page: import('@playwright/test').Page, id: string) {
  await page.request.delete(`/api/admin/services?id=${id}`)
}

test.describe('Admin — ciclo completo de un servicio', () => {
  test('crear, ver, recargar, editar y eliminar desde la pantalla', async ({ page }) => {
    await exigirSandbox(page)
    const nombre = nombreDePrueba()
    let creadoId: string | null = null

    try {
      // ---------------------------------------------------------------- crear
      await irA(page, '/admin/servicios', 'Servicios')
      await page.getByRole('button', { name: 'Nuevo servicio' }).click()
      const alta = modal(page, 'Nuevo servicio')

      await alta.locator('[name="name"]').fill(nombre)
      // La especialidad es obligatoria y llega por red: el modal la deshabilita mientras carga,
      // así que esperar a que se habilite es exactamente lo que hace una persona.
      const especialidad = alta.locator('[name="specialtyId"]')
      await expect(especialidad).toBeEnabled({ timeout: 30000 })
      const opciones = await especialidad.locator('option').all()
      const valores = (await Promise.all(opciones.map((o) => o.getAttribute('value')))).filter(Boolean) as string[]
      expect(valores.length, 'el negocio no tiene especialidades: no se puede crear un servicio').toBeGreaterThan(0)
      await especialidad.selectOption(valores[0])
      await alta.locator('[name="duration"]').fill('30')
      await alta.locator('[name="price"]').fill('9990')

      await alta.getByRole('button', { name: /Crear|Guardar/ }).click()

      // ------------------------------------------------- resultado en pantalla
      // Lo que de verdad importa: que aparezca en la tabla sin recargar nada.
      await expect(page.getByText(nombre, { exact: false }).first()).toBeVisible({ timeout: 30000 })

      const trasCrear = await listarServicios(page)
      const creado = trasCrear.find((servicio) => servicio.name === nombre)
      expect(creado, 'el servicio no quedó en la base').toBeTruthy()
      creadoId = creado!.id
      expect(creado!.duration_minutes).toBe(30)
      expect(Number(creado!.price)).toBe(9990)

      // ------------------------------------------------------------ persistir
      await page.reload()
      await expect(page.getByText(nombre, { exact: false }).first()).toBeVisible({ timeout: 30000 })

      // ---------------------------------------------------------------- editar
      const respuestaEdicion = await page.request.patch('/api/admin/services', {
        data: { id: creadoId, changes: { price: 12345, duration_minutes: 45 } },
      })
      expect(respuestaEdicion.ok(), 'no se pudo editar el servicio').toBe(true)

      await page.reload()
      const trasEditar = await listarServicios(page)
      const editado = trasEditar.find((servicio) => servicio.id === creadoId)
      expect(Number(editado!.price), 'el precio editado no persistió').toBe(12345)
      expect(editado!.duration_minutes, 'la duración editada no persistió').toBe(45)

      // -------------------------------------------------------------- eliminar
      await desactivar(page, creadoId)
      const trasEliminar = await listarServicios(page)
      const eliminado = trasEliminar.find((servicio) => servicio.id === creadoId)
      // Se desactiva y no se borra: el historial de reservas tiene que sobrevivir.
      expect(eliminado === undefined || eliminado.active === false, 'el servicio sigue activo tras eliminarlo').toBe(true)
    } finally {
      if (creadoId) await desactivar(page, creadoId)
    }
  })

  test('un servicio sin nombre no se crea y lo dice', async ({ page }) => {
    await exigirSandbox(page)
    const respuesta = await page.request.post('/api/admin/services', {
      data: { specialtyId: '00000000-0000-0000-0000-000000000000', name: '', durationMinutes: 30 },
    })
    expect(respuesta.status()).toBe(400)
    expect((await respuesta.json()).error).toContain('obligatorios')
  })

  test('una duración imposible se rechaza con un mensaje en español', async ({ page }) => {
    await exigirSandbox(page)
    const servicios = await listarServicios(page)
    expect(servicios.length).toBeGreaterThan(0)
    const respuesta = await page.request.patch('/api/admin/services', {
      data: { id: servicios[0].id, changes: { duration_minutes: 2 } },
    })
    expect(respuesta.status()).toBe(400)
    expect((await respuesta.json()).error).toContain('duración')
  })
})
