import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { numeroDePresupuesto, presupuestoComoHtml, presupuestoComoTexto, type NegocioDelDocumento, type PresupuestoParaDocumento } from '@/lib/quote-document'

/**
 * Finanzas: buscar, abrir y mandar.
 *
 * Del recorrido del dueño: «los cobros aparecen en una lista, pero al hacer clic no sucede
 * nada», «no se pueden abrir para revisar sus detalles», «en el caso de los presupuestos ni
 * siquiera existe una previsualización» y «debe poder enviarse por correo, WhatsApp o ambos».
 *
 * El documento se prueba como función pura: entra un presupuesto, sale el texto y el HTML. Así
 * se comprueba lo que de verdad recibe el cliente sin mandar nada a nadie.
 */

const NEGOCIO: NegocioDelDocumento = {
  name: 'Estética Bella Vida',
  logo_url: 'https://ejemplo.invalid/logo.png',
  address: 'Av. Providencia 1234',
  phone: '+56941398290',
  email: 'hola@bellavida.cl',
  currency: 'CLP',
  timezone: 'America/Santiago',
  settings: { brand_color: '#ff6f91' },
}

const PRESUPUESTO: PresupuestoParaDocumento = {
  id: '4cb0d138-6180-4842-8a88-1f633b08de5c',
  status: 'DRAFT',
  subtotal: 52000,
  discount: 2000,
  tax: 0,
  total: 50000,
  valid_until: '2026-09-15',
  notes: 'Incluye retoque a los 15 días.',
  created_at: '2026-08-18T13:00:00+00:00',
  client: { full_name: 'Ana Pérez', phone: '+56911112222', email: 'ana@ejemplo.cl' },
  professional: { display_name: 'Fernanda Muñoz' },
  quote_items: [
    { description: 'Coloración Completa', quantity: 1, unit_price: 38000, line_total: 38000 },
    { description: 'Diseño de Cejas', quantity: 2, unit_price: 7000, line_total: 14000 },
  ],
}

test.describe('El presupuesto es un documento, no una fila con un total', () => {
  test('el número es corto, estable y legible por teléfono', () => {
    expect(numeroDePresupuesto(PRESUPUESTO.id)).toBe('#4CB0D1')
    expect(numeroDePresupuesto(PRESUPUESTO.id)).toBe(numeroDePresupuesto(PRESUPUESTO.id))
  })

  test('el HTML lleva la identidad del negocio: logo y color', () => {
    const html = presupuestoComoHtml(NEGOCIO, PRESUPUESTO)
    expect(html).toContain('https://ejemplo.invalid/logo.png')
    expect(html).toContain('#ff6f91')
    expect(html).toContain('Estética Bella Vida')
    expect(html).toContain('Av. Providencia 1234')
  })

  test('sin logo cargado, el documento sale igual con el nombre del negocio', () => {
    const html = presupuestoComoHtml({ ...NEGOCIO, logo_url: null }, PRESUPUESTO)
    expect(html).not.toContain('<img')
    expect(html).toContain('Estética Bella Vida')
  })

  test('están todas las líneas, el descuento y el total', () => {
    const html = presupuestoComoHtml(NEGOCIO, PRESUPUESTO)
    expect(html).toContain('Coloración Completa')
    expect(html).toContain('Diseño de Cejas')
    expect(html).toContain('Descuento')
    expect(html).toContain('$50.000')
  })

  test('el impuesto en cero no ensucia el documento', () => {
    expect(presupuestoComoHtml(NEGOCIO, PRESUPUESTO)).not.toContain('Impuestos')
  })

  test('el texto de WhatsApp dice lo mismo que el correo', () => {
    const texto = presupuestoComoTexto(NEGOCIO, PRESUPUESTO)
    expect(texto).toContain('#4CB0D1')
    expect(texto).toContain('Coloración Completa')
    expect(texto).toContain('Diseño de Cejas ×2')
    expect(texto).toContain('$50.000')
    expect(texto).toContain('Ana Pérez')
    expect(texto).toContain('Fernanda Muñoz')
  })

  test('el nombre del cliente no puede romper el documento', () => {
    const html = presupuestoComoHtml(NEGOCIO, {
      ...PRESUPUESTO,
      client: { full_name: '<script>alert(1)</script>', phone: null, email: null },
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('un presupuesto vacío no revienta', () => {
    const vacio: PresupuestoParaDocumento = { id: 'abc', status: 'DRAFT', quote_items: [] }
    expect(() => presupuestoComoHtml(NEGOCIO, vacio)).not.toThrow()
    expect(() => presupuestoComoTexto(NEGOCIO, vacio)).not.toThrow()
  })
})

test.describe('Las listas se pueden buscar y abrir', () => {
  const pagina = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'admin', 'finanzas', 'page.tsx'), 'utf8')
  const api = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'admin', 'finance', 'route.ts'), 'utf8')

  test('hay un buscador y busca en el servidor, no solo en la página', () => {
    expect(pagina).toContain('Buscar por nombre o teléfono')
    expect(pagina).toContain('encodeURIComponent(q)')
    expect(api).toContain("url.searchParams.get('q')")
  })

  test('la búsqueda mira nombre, teléfono y correo del cliente', () => {
    expect(api).toContain('full_name')
    expect(api).toContain('phone')
    expect(api).toContain('email')
  })

  test('las cuatro listas abren una ficha', () => {
    expect((pagina.match(/setFicha\(\{ tipo/g) ?? []).length).toBe(4)
    expect(pagina).toContain("tipo: 'cobro'")
    expect(pagina).toContain("tipo: 'gasto'")
    expect(pagina).toContain("tipo: 'presupuesto'")
  })

  test('los botones de dentro de una fila no abren además la ficha', () => {
    // Sin esto, pulsar «Eliminar» abriría también el detalle: dos cosas de un clic.
    expect((pagina.match(/stopPropagation/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  test('se puede abrir con el teclado, no solo con el ratón', () => {
    expect(pagina).toContain('role="button"')
    expect(pagina).toContain('tabIndex={0}')
    expect(pagina).toContain('onKeyDown')
  })
})

test.describe('Enviar el presupuesto', () => {
  const envio = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'api', 'admin', 'quotes', 'send', 'route.ts'), 'utf8')

  test('acepta WhatsApp, correo o los dos', () => {
    expect(envio).toContain("['WHATSAPP', 'EMAIL', 'BOTH']")
  })

  test('solo marca ENVIADO si de verdad salió', () => {
    expect(envio).toContain('if (seEnvio &&')
    expect(envio).toContain("status: 'SENT'")
    expect(envio).toContain('sent: false')
  })

  test('el correo del presupuesto es transaccional, no marketing', () => {
    // Un presupuesto no lleva enlace de baja ni depende de consentimientos publicitarios.
    expect(envio).toContain('sendTransactionalEmail')
    expect(envio).not.toContain('sendMarketingEmail')
  })

  test('si el cliente no tiene dónde recibirlo, se dice claro', () => {
    expect(envio).toContain('no tiene teléfono guardado')
    expect(envio).toContain('no tiene correo guardado')
  })

  test('la ficha ofrece los tres botones y también imprimir', () => {
    const modal = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'FinanceDetailModal.tsx'), 'utf8')
    expect(modal).toContain('Enviar por WhatsApp')
    expect(modal).toContain('Enviar por correo')
    expect(modal).toContain('Enviar por ambos')
    expect(modal).toContain('Imprimir o guardar PDF')
  })
})
