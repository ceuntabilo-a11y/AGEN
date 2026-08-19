import { test, expect } from '@playwright/test'
import { cabeceraDeCorreo } from '@/lib/email-branding'

/**
 * Tanda 4: el logo del negocio aparece en sus correos (antes solo salía en el presupuesto).
 * `cabeceraDeCorreo` es la única pieza compartida entre las campañas de marketing y los avisos
 * automáticos (recordatorios, confirmaciones…), así que basta probarla una vez.
 */

test.describe('Cabecera de correo con o sin logo', () => {
  test('con logo, muestra la imagen', () => {
    const html = cabeceraDeCorreo({ name: 'Estética Bella Vida', logo_url: 'https://cdn.test/logo.png' })
    expect(html).toContain('<img')
    expect(html).toContain('https://cdn.test/logo.png')
    expect(html).toContain('Estética Bella Vida')
  })

  test('sin logo, cae al nombre en negrita', () => {
    const html = cabeceraDeCorreo({ name: 'Estética Bella Vida', logo_url: null })
    expect(html).not.toContain('<img')
    expect(html).toContain('Estética Bella Vida')
  })

  test('el nombre y el enlace del logo no pueden inyectar HTML', () => {
    const html = cabeceraDeCorreo({ name: '<script>alert(1)</script>', logo_url: '"><img onerror=alert(1)>' })
    // Un solo <img real (el que arma la función): lo que mandó el negocio queda escapado
    // adentro del atributo, no como una etiqueta nueva.
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
