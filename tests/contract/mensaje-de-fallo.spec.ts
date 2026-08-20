import { test, expect } from '@playwright/test'
import { mensajeDeFallo } from '../../src/lib/api-fetch-error'

/**
 * Antes, cualquier fallo de cualquier pantalla mostraba "Conecta Supabase" — casi siempre falso,
 * porque casi nunca es Supabase el problema. Estas pruebas fijan que cada código HTTP real
 * produzca un mensaje distinto y accionable, y que solo el fallo de red de verdad mencione la
 * conexión.
 */
test.describe('mensajeDeFallo', () => {
  test('sin respuesta (fallo de red real) es el único caso que menciona la conexión', () => {
    const mensaje = mensajeDeFallo(null, 'ver las cifras')
    expect(mensaje).toContain('conexión')
    expect(mensaje).toContain('ver las cifras')
  })

  test('401 dice que la sesión expiró, no "conecta Supabase"', () => {
    const mensaje = mensajeDeFallo(401, 'ver las cifras')
    expect(mensaje).toContain('sesión')
    expect(mensaje).not.toContain('Supabase')
  })

  test('403 dice que no hay permiso, con el contexto de la pantalla', () => {
    const mensaje = mensajeDeFallo(403, 'administrar clientes')
    expect(mensaje).toContain('permiso')
    expect(mensaje).toContain('administrar clientes')
  })

  test('429 avisa de demasiadas solicitudes, no de un problema de conexión', () => {
    expect(mensajeDeFallo(429, 'ver esto')).toContain('Demasiadas')
  })

  test('500 y otros errores de servidor no se confunden con la sesión ni el permiso', () => {
    const mensaje = mensajeDeFallo(500, 'ver las cifras')
    expect(mensaje).not.toContain('sesión')
    expect(mensaje).not.toContain('permiso')
    expect(mensaje).toContain('servidor')
  })

  test('ningún mensaje real culpa a Supabase', () => {
    for (const status of [null, 401, 403, 404, 429, 500, 502, 503]) {
      expect(mensajeDeFallo(status, 'esto')).not.toContain('Supabase')
    }
  })
})
