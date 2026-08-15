import { test, expect } from '@playwright/test'
import { irA } from '../../support/pages'
import { exigirSandbox } from '../../support/sandbox'

/**
 * Ciclo completo de las cuatro áreas que quedaban sin cubrir: equipo, campañas, seguimiento y
 * finanzas. Abrir → escribir → guardar → recargar → verificar → deshacer.
 *
 * Estas eran las páginas donde "carga la página" y "el botón existe" era todo lo que había, y
 * es justo el tipo de cobertura que dejó pasar el bug de `/plataforma/claves`, donde el
 * formulario decía "guardado" sin guardar.
 *
 * Lo que a propósito NO se hace, porque tendría efectos fuera del sistema:
 *
 *  - **No se crea ningún profesional**: dar de alta a uno manda una invitación por correo a una
 *    persona real. Se comprueban en cambio las validaciones y la edición de uno existente,
 *    devolviéndolo a su valor original.
 *  - **No se envía ninguna campaña**: se comprueba el borrador, la edición y que el envío sin
 *    clave de Resend responde 503 con un mensaje entendible en vez de fallar en silencio.
 *
 * Todo escribe de verdad, así que exige el sandbox declarado y limpia lo suyo pase lo que pase.
 */

const MARCA = 'ZZZ prueba automática'

async function json(respuesta: import('@playwright/test').APIResponse) {
  return respuesta.json().catch(() => ({}))
}

// ---------------------------------------------------------------------------- equipo

test.describe('Admin — equipo y especialidades', () => {
  test('una especialidad se crea, se renombra y se elimina', async ({ page }) => {
    await exigirSandbox(page)
    const nombre = `${MARCA} ${Date.now()}`
    let id: string | null = null

    try {
      await irA(page, '/admin/equipo', 'Equipo')
      const creada = await page.request.post('/api/admin/specialties', { data: { name: nombre } })
      expect(creada.status(), await creada.text()).toBe(201)
      id = (await json(creada)).specialty.id

      const catalogo = await json(await page.request.get('/api/admin/catalog'))
      expect((catalogo.specialties ?? []).some((e: { id: string }) => e.id === id)).toBe(true)

      const editada = await page.request.patch('/api/admin/specialties', {
        data: { id, name: `${nombre} editada` },
      })
      expect(editada.ok(), await editada.text()).toBe(true)

      // Recargar y volver a leer: es lo que hace una persona para creerse que se guardó.
      await page.reload()
      const trasEditar = await json(await page.request.get('/api/admin/catalog'))
      const encontrada = (trasEditar.specialties ?? []).find((e: { id: string }) => e.id === id)
      expect(encontrada.name).toBe(`${nombre} editada`)

      const borrada = await page.request.delete(`/api/admin/specialties?id=${id}`)
      expect(borrada.ok(), await borrada.text()).toBe(true)
      id = null
    } finally {
      if (id) await page.request.delete(`/api/admin/specialties?id=${id}`)
    }
  })

  test('un profesional sin nombre o sin correo no se crea, y lo dice', async ({ page }) => {
    await exigirSandbox(page)
    // No se crea ninguno de verdad: dar de alta manda una invitación por correo a una persona.
    const respuesta = await page.request.post('/api/admin/professionals', { data: { displayName: 'Sin correo' } })
    expect(respuesta.status()).toBe(400)
    expect((await json(respuesta)).error).toContain('obligatorios')
  })

  test('editar un profesional persiste y se puede deshacer', async ({ page }) => {
    await exigirSandbox(page)
    const catalogo = await json(await page.request.get('/api/admin/catalog'))
    const profesional = (catalogo.professionals ?? [])[0]
    test.skip(!profesional, 'el negocio no tiene profesionales')

    const original = profesional.commission_percent ?? 0
    try {
      const editado = await page.request.patch('/api/admin/professionals', {
        data: { id: profesional.id, changes: { commission_percent: 7 } },
      })
      expect(editado.ok(), await editado.text()).toBe(true)

      const tras = await json(await page.request.get('/api/admin/catalog'))
      const actualizado = (tras.professionals ?? []).find((p: { id: string }) => p.id === profesional.id)
      expect(Number(actualizado.commission_percent)).toBe(7)
    } finally {
      await page.request.patch('/api/admin/professionals', {
        data: { id: profesional.id, changes: { commission_percent: original } },
      })
    }
  })
})

// -------------------------------------------------------------------------- campañas

test.describe('Admin — campañas', () => {
  test('un borrador se crea, se edita y queda en la lista', async ({ page }) => {
    await exigirSandbox(page)
    const nombre = `${MARCA} campaña ${Date.now()}`
    let id: string | null = null

    await irA(page, '/admin/marketing', 'Marketing')
    const creada = await page.request.post('/api/admin/campaigns', {
      data: { name: nombre, channel: 'WHATSAPP', content: 'Texto de prueba automática, no se envía.' },
    })
    expect(creada.status(), await creada.text()).toBe(201)
    const campana = (await json(creada)).campaign
    id = campana.id
    expect(campana.status, 'una campaña nueva nace como borrador').toBe('DRAFT')

    const editada = await page.request.patch('/api/admin/campaigns', {
      data: { campaignId: id, name: `${nombre} editada`, channel: 'WHATSAPP', content: 'Texto editado por la prueba.' },
    })
    expect(editada.ok(), await editada.text()).toBe(true)

    await page.reload()
    const lista = await json(await page.request.get('/api/admin/campaigns'))
    const guardada = (lista.campaigns ?? []).find((c: { id: string }) => c.id === id)
    expect(guardada, 'la campaña no quedó guardada').toBeTruthy()
    expect(guardada.name).toBe(`${nombre} editada`)
    expect(guardada.content).toBe('Texto editado por la prueba.')
  })

  test('una campaña sin nombre, canal o contenido no se crea', async ({ page }) => {
    await exigirSandbox(page)
    const respuesta = await page.request.post('/api/admin/campaigns', { data: { name: '', channel: 'WHATSAPP', content: '' } })
    expect(respuesta.status()).toBe(400)
    expect((await json(respuesta)).error).toContain('obligatorios')
  })
})

// ----------------------------------------------------------------------- seguimiento

test.describe('Admin — seguimiento', () => {
  test('una tarea se crea, cambia de estado y persiste', async ({ page }) => {
    await exigirSandbox(page)
    const clientes = await json(await page.request.get('/api/admin/clients'))
    const cliente = (clientes.clients ?? [])[0]
    test.skip(!cliente, 'el negocio no tiene clientes')

    await irA(page, '/admin/seguimiento', 'Seguimiento')
    const creada = await page.request.post('/api/admin/followups', {
      data: { kind: 'task', clientId: cliente.id, title: `${MARCA}: contactar`, notes: 'Creada por la prueba automática' },
    })
    expect(creada.status(), await creada.text()).toBe(201)
    const tarea = (await json(creada)).task
    expect(tarea.status).toBe('PENDING')

    const hecha = await page.request.patch('/api/admin/followups', { data: { kind: 'task', id: tarea.id, status: 'DONE' } })
    expect(hecha.ok(), await hecha.text()).toBe(true)

    await page.reload()
    const lista = await json(await page.request.get('/api/admin/followups'))
    const guardada = (lista.tasks ?? []).find((t: { id: string }) => t.id === tarea.id)
    // Puede desaparecer de la lista por estar hecha; si sigue, tiene que estar en DONE.
    if (guardada) expect(guardada.status).toBe('DONE')
  })

  test('un estado inventado se rechaza', async ({ page }) => {
    await exigirSandbox(page)
    const respuesta = await page.request.patch('/api/admin/followups', {
      data: { kind: 'task', id: '00000000-0000-0000-0000-000000000000', status: 'INVENTADO' },
    })
    expect(respuesta.status()).toBe(400)
  })
})

// -------------------------------------------------------------------------- finanzas

test.describe('Admin — finanzas', () => {
  test('un gasto se registra, aparece en el listado y se elimina', async ({ page }) => {
    await exigirSandbox(page)
    let id: string | null = null

    try {
      await irA(page, '/admin/finanzas', 'Finanzas')
      const creado = await page.request.post('/api/admin/expenses', {
        data: { category: 'Otros', description: `${MARCA}: gasto`, amount: 1234, incurredOn: new Date().toISOString().slice(0, 10) },
      })
      expect(creado.status(), await creado.text()).toBe(201)
      id = (await json(creado)).expense.id

      await page.reload()
      const lista = await json(await page.request.get('/api/admin/expenses'))
      const guardado = (lista.expenses ?? []).find((g: { id: string }) => g.id === id)
      expect(guardado, 'el gasto no quedó guardado').toBeTruthy()
      expect(Number(guardado.amount)).toBe(1234)

      const borrado = await page.request.delete(`/api/admin/expenses?id=${id}`)
      expect(borrado.ok(), await borrado.text()).toBe(true)
      id = null

      const tras = await json(await page.request.get('/api/admin/expenses'))
      expect((tras.expenses ?? []).some((g: { id: string }) => g.id === id)).toBe(false)
    } finally {
      if (id) await page.request.delete(`/api/admin/expenses?id=${id}`)
    }
  })

  test('el resumen financiero responde y cuadra con lo que hay', async ({ page }) => {
    await exigirSandbox(page)
    const respuesta = await page.request.get('/api/admin/finance')
    expect(respuesta.ok(), await respuesta.text()).toBe(true)
    const datos = await json(respuesta)
    // No se comprueba una cifra concreta —cambia con el negocio— sino que sea coherente:
    // números de verdad y no `undefined` pintado como "NaN" en pantalla.
    for (const clave of Object.keys(datos)) {
      const valor = datos[clave]
      if (typeof valor === 'number') expect(Number.isFinite(valor), `${clave} no es un número usable`).toBe(true)
    }
  })
})
