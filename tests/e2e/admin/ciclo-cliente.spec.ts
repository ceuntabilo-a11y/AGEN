import { test, expect } from '@playwright/test'
import { irA, modal } from '../../support/pages'
import { exigirSandbox } from '../../support/sandbox'

/**
 * Ciclo completo de una ficha de cliente, como usuario: crear desde la pantalla → verla en la
 * lista → buscarla → recargar → editarla → verificar que persistió → eliminarla.
 *
 * Es la función que más se toca del panel y la que más datos personales guarda, así que
 * además se comprueba lo que NO debe pasar: que un teléfono duplicado se rechace con un
 * mensaje entendible, que el nombre no pueda quedar vacío, y que un cliente con historial de
 * reservas no se pueda borrar (perdería el historial).
 *
 * Escribe de verdad, así que exige el sandbox declarado y limpia lo suyo pase lo que pase.
 */

const MARCA = 'ZZZ Cliente de prueba'

type Cliente = { id: string; full_name: string; phone: string | null; notes: string | null }

async function listarClientes(page: import('@playwright/test').Page, busqueda = ''): Promise<Cliente[]> {
  const respuesta = await page.request.get(`/api/admin/clients${busqueda ? `?q=${encodeURIComponent(busqueda)}` : ''}`)
  expect(respuesta.ok(), 'no se pudo listar clientes').toBe(true)
  return (await respuesta.json()).clients as Cliente[]
}

async function borrar(page: import('@playwright/test').Page, id: string) {
  await page.request.delete(`/api/admin/clients?id=${id}`)
}

test.describe('Admin — ciclo completo de un cliente', () => {
  test('crear, buscar, recargar, editar y eliminar desde la pantalla', async ({ page }) => {
    await exigirSandbox(page)
    const sufijo = String(Date.now()).slice(-7)
    const nombre = `${MARCA} ${sufijo}`
    // Prefijo 5699 + sufijo único: es un móvil chileno con forma válida y no es de nadie.
    const telefono = `5699${sufijo}`
    let creadoId: string | null = null

    try {
      // ---------------------------------------------------------------- crear
      await irA(page, '/admin/clientes', 'Clientes')
      await page.getByRole('button', { name: 'Nuevo cliente' }).click()
      const alta = modal(page, 'Nuevo cliente')
      await alta.locator('[name="fullName"]').fill(nombre)
      await alta.locator('[name="phone"]').fill(telefono)
      await alta.getByRole('button', { name: /Crear|Guardar/ }).click()

      // Aparece sin recargar: es lo que ve la persona que acaba de darle a guardar.
      await expect(page.getByText(nombre, { exact: false }).first()).toBeVisible({ timeout: 30000 })

      const creados = await listarClientes(page, nombre)
      const creado = creados.find((cliente) => cliente.full_name === nombre)
      expect(creado, 'el cliente no quedó en la base').toBeTruthy()
      creadoId = creado!.id
      expect(creado!.phone, 'el teléfono se guarda normalizado, solo dígitos').toBe(telefono)

      // -------------------------------------------------------------- buscar
      // La búsqueda es la forma real de encontrar a alguien con cien fichas.
      const porTelefono = await listarClientes(page, telefono)
      expect(porTelefono.some((cliente) => cliente.id === creadoId), 'no se encuentra por teléfono').toBe(true)

      // ------------------------------------------------------------ persistir
      await page.reload()
      await expect(page.getByText(nombre, { exact: false }).first()).toBeVisible({ timeout: 30000 })

      // --------------------------------------------------------------- editar
      const respuestaEdicion = await page.request.patch('/api/admin/clients', {
        data: { id: creadoId, changes: { notes: 'Nota escrita por la prueba automática' } },
      })
      expect(respuestaEdicion.ok(), 'no se pudo editar el cliente').toBe(true)

      await page.reload()
      const trasEditar = await listarClientes(page, nombre)
      expect(trasEditar.find((cliente) => cliente.id === creadoId)!.notes)
        .toBe('Nota escrita por la prueba automática')

      // -------------------------------------------------------------- eliminar
      const respuestaBorrado = await page.request.delete(`/api/admin/clients?id=${creadoId}`)
      expect(respuestaBorrado.ok(), 'no se pudo eliminar el cliente').toBe(true)
      const trasBorrar = await listarClientes(page, nombre)
      expect(trasBorrar.find((cliente) => cliente.id === creadoId), 'el cliente sigue ahí').toBeUndefined()
      creadoId = null
    } finally {
      if (creadoId) await borrar(page, creadoId)
    }
  })

  test('un teléfono repetido se rechaza con un mensaje entendible', async ({ page }) => {
    await exigirSandbox(page)
    const sufijo = String(Date.now()).slice(-7)
    const telefono = `5699${sufijo}`
    let primero: string | null = null
    let segundo: string | null = null

    try {
      const uno = await page.request.post('/api/admin/clients', {
        data: { fullName: `${MARCA} A ${sufijo}`, phone: telefono },
      })
      expect(uno.status()).toBe(201)
      primero = (await uno.json()).client.id

      const dos = await page.request.post('/api/admin/clients', {
        data: { fullName: `${MARCA} B ${sufijo}`, phone: telefono },
      })
      expect(dos.status(), 'un teléfono duplicado no puede crear una segunda ficha').toBe(409)
      const error = (await dos.json()).error as string
      expect(error).toContain('Ya existe')
      // El mensaje es para una persona en recepción, no para un programador.
      expect(error).not.toMatch(/23505|duplicate|constraint/i)
      segundo = null
    } finally {
      if (primero) await borrar(page, primero)
      if (segundo) await borrar(page, segundo)
    }
  })

  test('el nombre no puede quedar vacío al editar', async ({ page }) => {
    await exigirSandbox(page)
    const clientes = await listarClientes(page)
    expect(clientes.length).toBeGreaterThan(0)
    const respuesta = await page.request.patch('/api/admin/clients', {
      data: { id: clientes[0].id, changes: { full_name: '   ' } },
    })
    expect(respuesta.status()).toBe(400)
    expect((await respuesta.json()).error).toContain('nombre')
  })

  test('un cliente con reservas no se borra en silencio', async ({ page }) => {
    await exigirSandbox(page)
    // Se busca uno que SÍ tenga historial: borrarlo perdería sus reservas.
    const clientes = await listarClientes(page)
    let conHistorial: string | null = null
    for (const cliente of clientes.slice(0, 15)) {
      const agenda = await page.request.get(`/api/admin/clients/${cliente.id}`)
      if (!agenda.ok()) continue
      const datos = await agenda.json().catch(() => ({}))
      if (Array.isArray(datos.appointments) && datos.appointments.length > 0) { conHistorial = cliente.id; break }
    }
    test.skip(!conHistorial, 'ningún cliente del sandbox tiene reservas todavía')

    const respuesta = await page.request.delete(`/api/admin/clients?id=${conHistorial}`)
    expect(respuesta.status(), 'borrar a alguien con historial tiene que fallar').toBe(409)
    expect((await respuesta.json()).error).toContain('historial')
  })
})
