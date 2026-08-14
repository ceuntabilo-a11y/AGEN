import { test, expect } from '@playwright/test'

/**
 * `/api/health` contra el build de verdad.
 *
 * Las pruebas de contrato comprueban la lógica (`src/lib/version.ts`) sin levantar nada, y
 * pasan aunque el commit no llegue: la lógica está bien, lo que puede fallar es la inyección.
 * Y falló: `next.config.mjs` inyecta el commit con la opción `env`, que sustituye
 * TEXTUALMENTE `process.env.AGEN_COMMIT` al compilar, así que un acceso dinámico deja el campo
 * en `desconocido` sin romper ni el build ni el lint ni el contrato.
 *
 * Esta prueba corre contra el servidor ya construido, que es el único sitio donde ese fallo se
 * ve. No necesita sesión ni credenciales: la ruta es pública y no devuelve datos de negocio.
 */

test.describe('El servicio desplegado dice qué versión sirve', () => {
  test('responde ok, service y un commit real', async ({ request }) => {
    const respuesta = await request.get('/api/health')
    expect(respuesta.status()).toBe(200)

    const cuerpo = await respuesta.json()
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.service).toBe('agen')
    expect(cuerpo.commit).not.toBe('desconocido')
    expect(cuerpo.commit).toMatch(/^[0-9a-f]{7,40}$/)
    expect(cuerpo.commitCorto).toBe(String(cuerpo.commit).slice(0, 7))
    expect(Date.parse(cuerpo.compiladoEn)).not.toBeNaN()
  })

  test('no se sirve desde caché: el timestamp avanza entre dos peticiones', async ({ request }) => {
    // Si un proxy intermedio guardara esta respuesta, la monitorización estaría comprobando la
    // salud de una copia vieja — incluido el commit, que es justo el dato que debe ser el de ahora.
    const primera = await (await request.get('/api/health')).json()
    await new Promise((listo) => setTimeout(listo, 1100))
    const segunda = await (await request.get('/api/health')).json()
    expect(segunda.timestamp).not.toBe(primera.timestamp)
    expect(segunda.commit).toBe(primera.commit)
  })

  test('sigue siendo barata: responde muy por debajo de su presupuesto', async ({ request }) => {
    // Presupuesto del monitor: 800 ms para la ruta completa contra producción, que incluye el
    // viaje de red. Contra el servidor local eso deja margen de sobra; si esto se acerca, es
    // que la ruta empezó a hacer trabajo que no le toca (base de datos, red, disco).
    await request.get('/api/health') // calentamiento: la primera petición carga la ruta
    const arranque = Date.now()
    for (let i = 0; i < 10; i += 1) {
      const respuesta = await request.get('/api/health')
      expect(respuesta.status()).toBe(200)
    }
    const media = (Date.now() - arranque) / 10
    expect(media).toBeLessThan(150)
  })
})
