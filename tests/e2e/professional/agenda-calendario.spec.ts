import { test, expect } from '@playwright/test'
import { irA } from '../../support/pages'

/**
 * La agenda dibujando datos, sin escribir nada en la base.
 *
 * Se intercepta `/api/professional/agenda` y se le da una semana inventada: así se comprueba
 * lo que un profesional ve —citas colocadas por hora, con su duración, descansos, bloqueos y
 * huecos libres— sin crear reservas de verdad en el negocio, que es producción.
 *
 * La aritmética ya está cubierta por `tests/contract/agenda-calendario.spec.ts`. Lo que se
 * comprueba acá es lo otro: que el componente pinte esos datos, que se puedan abrir y que la
 * pantalla no se rompa.
 */

const ZONA = 'America/Santiago'

/**
 * El lunes de la semana que la agenda está mostrando AHORA.
 *
 * Estaba fijo en `2026-08-10` con el comentario «para que la prueba no dependa del día en que se
 * ejecute», y era justo al revés: la agenda abre siempre en la semana en curso, así que en
 * cuanto pasó ese lunes las citas inventadas cayeron fuera de la vista y la prueba empezó a
 * fallar sola, sin que nadie tocara la agenda. Una prueba con fecha de caducidad enseña a
 * ignorar el rojo, que es peor que no tenerla.
 *
 * Se calcula en la zona del negocio, no en la del runner de CI: en Santiago puede ser lunes
 * mientras en UTC todavía es domingo, y entonces la semana mostrada sería otra.
 */
function lunesDeEstaSemana() {
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: ZONA }))
  // getDay(): 0 = domingo. El lunes es el día 1, y desde el domingo hay que retroceder seis.
  const retroceso = (hoy.getDay() + 6) % 7
  hoy.setDate(hoy.getDate() - retroceso)
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
}

const LUNES = lunesDeEstaSemana()

/** El día siguiente al lunes mostrado, para el bloqueo de la mañana del martes. */
const MARTES = (() => { const d = new Date(`${LUNES}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()

/** `YYYY-MM-DD` + hora local de Santiago → ISO UTC (agosto: UTC-4). */
const enSantiago = (dia: string, hora: string) => `${dia}T${String(Number(hora.slice(0, 2)) + 4).padStart(2, '0')}${hora.slice(2)}:00.000Z`

const respuesta = {
  professional: { id: 'prof-1', display_name: 'Valentina Soto', color: '#5b3df5' },
  timezone: ZONA,
  availability: [
    // Jornada partida el lunes: crea un descanso visible de 13:00 a 15:00.
    { weekday: 1, startsAt: '09:00', endsAt: '13:00' },
    { weekday: 1, startsAt: '15:00', endsAt: '19:00' },
    ...[2, 3, 4, 5].map((weekday) => ({ weekday, startsAt: '09:00', endsAt: '19:00' })),
  ],
  businessHours: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, enabled: day <= 5, start: '09:00', end: '19:00' })),
  appointments: [
    {
      id: 'cita-1',
      status: 'CONFIRMED',
      service_period: `["${enSantiago(LUNES, '10:00')}","${enSantiago(LUNES, '11:00')}")`,
      client_confirmed_at: `${LUNES}T02:00:00Z`,
      client: { id: 'c1', full_name: 'Ana Pérez', phone: '56911112222' },
      service: { id: 's1', name: 'Corte y peinado' },
    },
    {
      id: 'cita-2',
      status: 'PENDING',
      service_period: `["${enSantiago(LUNES, '16:00')}","${enSantiago(LUNES, '16:30')}")`,
      client_confirmed_at: null,
      client: { id: 'c2', full_name: 'Bruno Díaz', phone: '56911113333' },
      service: { id: 's2', name: 'Manicure' },
    },
  ],
  blocks: [
    {
      id: 'bloqueo-1',
      period: `["${enSantiago(MARTES, '09:00')}","${enSantiago(MARTES, '11:00')}")`,
      reason: 'Capacitación',
    },
  ],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/professional/agenda?*', async (ruta) => {
    if (ruta.request().method() !== 'GET') return ruta.continue()
    await ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuesta) })
  })
})

test.describe('La agenda dibuja la semana', () => {
  test('cada cita aparece con su hora, su cliente y su servicio', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    // Botón de la cita: la etiqueta accesible lleva horas, cliente y estado.
    const cita = page.getByRole('button', { name: /10:00 a 11:00, Ana Pérez/ })
    await expect(cita).toBeVisible()
    await expect(page.getByRole('button', { name: /16:00 a 16:30, Bruno Díaz/ })).toBeVisible()
  })

  test('la duración se ve a escala: una hora ocupa el doble que media', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    const larga = await page.getByRole('button', { name: /Ana Pérez/ }).boundingBox()
    const corta = await page.getByRole('button', { name: /Bruno Díaz/ }).boundingBox()
    expect(larga).not.toBeNull()
    expect(corta).not.toBeNull()
    // Tolerancia amplia: lo que importa es que sea proporcional, no el píxel exacto.
    expect(larga!.height / corta!.height).toBeGreaterThan(1.6)
  })

  test('el bloqueo se ve y dice por qué', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await expect(page.getByText('Capacitación').first()).toBeVisible()
  })

  test('los huecos libres se ofrecen para bloquear', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    // 09:00–10:00 del lunes queda libre entre el inicio de jornada y la primera cita.
    await expect(page.getByRole('button', { name: /Libre de 09:00 a 10:00/ })).toBeVisible()
  })

  test('pulsar un hueco libre abre el bloqueo con esas horas ya puestas', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: /Libre de 09:00 a 10:00/ }).click()
    const desde = page.locator('[name="from"]')
    await expect(desde).toBeVisible()
    await expect(desde).toHaveValue(/T09:00$/)
    await expect(page.locator('[name="until"]')).toHaveValue(/T10:00$/)
  })

  test('un día que el negocio cierra se marca, no se ofrece', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await expect(page.getByText('No atiendes').first()).toBeVisible()
  })

  test('abrir una cita muestra su detalle', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: /Ana Pérez/ }).first().click()
    await expect(page.getByText('Ana Pérez').first()).toBeVisible()
  })

  test('la lista del día acompaña al calendario con las acciones de siempre', async ({ page }) => {
    await irA(page, '/profesional/agenda', 'Mi agenda')
    await page.getByRole('button', { name: 'Día', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Bloquear horario' }).first()).toBeVisible()
  })
})
