import { test, expect } from '@playwright/test'
import { campoJson, camposDelContexto, contextoDelAgente } from '../support/n8n'
import { agrupar, catalogo, contextoUnido, entrada, memoriaCliente, memoriaEquipo, ZONA } from './fixtures'

/**
 * Contrato del contexto que recibe el modelo.
 *
 * Evalúa la plantilla real del nodo "Agente Agen" (n8n-workflows/01-agen-agent.json) con los
 * datos que los endpoints ya devuelven, y comprueba que la información necesaria llega al
 * mensaje. No juzga la redacción del modelo: solo si el dato está o no está.
 *
 * Cubre los hallazgos C1, C3 y M3 de la auditoría.
 */

const construir = (mensaje: string, memoria: Record<string, unknown>, telefono?: string) =>
  contextoDelAgente({
    json: contextoUnido(memoria),
    nodos: { Entrada: entrada(mensaje, telefono), Agrupar: agrupar(mensaje) },
  })

test.describe('Contexto del agente — base que ya funcionaba', () => {
  test('el mensaje agrupado, el negocio, el actor y la zona viajan al modelo', () => {
    const contexto = construir('Hola, quiero una hora', memoriaCliente)
    const campos = camposDelContexto(contexto)
    expect(campos.MENSAJE).toBe('Hola, quiero una hora')
    expect(campos.NEGOCIO).toBe(catalogo.business.id)
    expect(campos.ACTOR).toBe('CLIENT')
    expect(campos.ZONA).toBe(ZONA)
    // La referencia temporal viaja en TIEMPO (ver tiempo.spec.ts). El antiguo campo AHORA,
    // que obligaba al modelo a convertir UTC a mano, ya no existe.
    expect(campos.AHORA).toBeUndefined()
  })

  test('las reservas del cliente llegan ya formateadas', () => {
    const conReserva = {
      ...memoriaCliente,
      appointments: [{ appointmentId: 'cita-9', status: 'CONFIRMED', confirmedByClient: true, date: 'lunes, 10 de agosto', time: '10:00', serviceName: 'Manicura Semipermanente', professionalName: 'Camila Rojas' }],
    }
    const reservas = campoJson<Array<{ time: string; serviceName: string }>>(construir('¿A qué hora era mi hora?', conReserva), 'RESERVAS')
    expect(reservas).toHaveLength(1)
    expect(reservas[0].time).toBe('10:00')
    expect(reservas[0].serviceName).toBe('Manicura Semipermanente')
  })
})

/**
 * C1 — El modo TEAM recibe la agenda, la lista de espera y los seguimientos.
 *
 * /api/agent/memory ya devuelve `teamMember`, `today`, `waiting` y `followups`, y el system
 * prompt ordena responder "con nombres y horas concretas". Si estos datos no llegan al
 * mensaje, al modelo se le está pidiendo algo imposible.
 */
test.describe('C1 — contexto del equipo', () => {
  test('ACTOR pasa a TEAM y se identifica a quién escribe', () => {
    const contexto = construir('¿Quién viene hoy?', memoriaEquipo, '56999998888')
    expect(camposDelContexto(contexto).ACTOR).toBe('TEAM')
    const equipo = campoJson<{ name: string; role: string; professionalId: string }>(contexto, 'EQUIPO')
    expect(equipo.name).toBe('Camila Rojas')
    expect(equipo.role).toBe('PROFESSIONAL')
    expect(equipo.professionalId).toBe('prof-camila')
  })

  test('"¿Quién viene hoy?" — la agenda del día llega con cliente, servicio y hora local', () => {
    const contexto = construir('¿Quién viene hoy?', memoriaEquipo, '56999998888')
    const agenda = campoJson<Array<{ hora: string; cliente: string; servicio: string; profesional: string; estado: string }>>(contexto, 'AGENDA_HOY')
    expect(agenda).toHaveLength(2)
    expect(agenda[0].cliente).toBe('Josefa Fuentes')
    expect(agenda[0].servicio).toBe('Manicura Semipermanente')
    expect(agenda[0].profesional).toBe('Camila Rojas')
    expect(agenda[0].estado).toBe('CONFIRMED')
    // 14:00Z en America/Santiago son las 10:00: la hora debe venir ya convertida,
    // no como un rango en UTC que el modelo tendría que interpretar.
    expect(agenda[0].hora).toBe('10:00')
    expect(agenda[1].hora).toBe('16:30')
    expect(agenda[1].cliente).toBe('Trinidad Silva')
  })

  test('"¿Hay alguien en lista de espera?" — el número llega al contexto', () => {
    const campos = camposDelContexto(construir('¿Hay alguien en lista de espera?', memoriaEquipo, '56999998888'))
    expect(campos.ESPERA).toBe('3')
  })

  test('"¿Qué seguimientos tengo pendientes?" — el número llega al contexto', () => {
    const campos = camposDelContexto(construir('¿Qué seguimientos tengo pendientes?', memoriaEquipo, '56999998888'))
    expect(campos.SEGUIMIENTOS).toBe('2')
  })

  test('un cliente normal no recibe la agenda del negocio', () => {
    const campos = camposDelContexto(construir('Hola', memoriaCliente))
    expect(campos.ACTOR).toBe('CLIENT')
    expect(campos.AGENDA_HOY).toBeUndefined()
    expect(campos.EQUIPO).toBeUndefined()
    expect(campos.ESPERA).toBeUndefined()
    expect(campos.SEGUIMIENTOS).toBeUndefined()
  })
})

/**
 * C3 — Cada servicio conserva su especialidad.
 *
 * El catálogo la devuelve y el prompt exige "no confundas peluquería, manicure, pedicure",
 * pero si la especialidad no viaja el modelo solo puede adivinar por el nombre.
 */
test.describe('C3 — especialidad de los servicios', () => {
  type Servicio = { id: string; nombre: string; min: number; precio: number; especialidad: { id: string; nombre: string; slug: string } | null }

  test('cada servicio lleva id, nombre, duración, precio y especialidad', () => {
    const servicios = campoJson<Servicio[]>(construir('¿Qué servicios tienen?', memoriaCliente), 'SERVICIOS')
    expect(servicios).toHaveLength(3)
    for (const servicio of servicios) {
      expect(servicio.id).toBeTruthy()
      expect(servicio.nombre).toBeTruthy()
      expect(typeof servicio.min).toBe('number')
      expect(typeof servicio.precio).toBe('number')
      // Debe existir el objeto completo: `undefined` también es un fallo.
      expect(servicio.especialidad, `${servicio.nombre} llegó sin especialidad`).toBeTruthy()
      expect(servicio.especialidad?.nombre, `${servicio.nombre} sin nombre de especialidad`).toBeTruthy()
      expect(servicio.especialidad?.slug, `${servicio.nombre} sin slug de especialidad`).toBeTruthy()
    }
  })

  test('"¿Qué servicios de manicure tienen?" — se distinguen por especialidad, no por el nombre', () => {
    const servicios = campoJson<Servicio[]>(construir('¿Qué servicios de manicure tienen?', memoriaCliente), 'SERVICIOS')
    const manos = servicios.filter((servicio) => servicio.especialidad?.slug === 'manicura-pedicura')
    expect(manos.map((servicio) => servicio.nombre).sort()).toEqual(['Manicura Semipermanente', 'Pedicura Spa'])
    // "Pedicura Spa" no contiene la palabra "manicure": sin la especialidad se perdería.
    expect(manos.some((servicio) => !/manicur/i.test(servicio.nombre))).toBe(true)
    const pelo = servicios.filter((servicio) => servicio.especialidad?.slug === 'peluqueria-estilismo')
    expect(pelo.map((servicio) => servicio.nombre)).toEqual(['Coloración Completa'])
  })

  test('"¿Cuánto cuesta la Manicura Semipermanente?" — precio y duración exactos', () => {
    const servicios = campoJson<Servicio[]>(construir('¿Cuánto cuesta la Manicura Semipermanente?', memoriaCliente), 'SERVICIOS')
    const manicura = servicios.find((servicio) => servicio.nombre === 'Manicura Semipermanente')
    expect(manicura?.precio).toBe(14000)
    expect(manicura?.min).toBe(50)
  })
})

/**
 * M3 — Los datos del negocio que el catálogo ya devuelve llegan al modelo.
 *
 * La regla 11 del prompt obliga a usar "el maps_url exacto o la dirección guardada".
 */
test.describe('M3 — ficha del negocio', () => {
  type Ficha = {
    nombre: string | null
    telefono: string | null
    direccion: string | null
    mapsUrl: string | null
    zona: string
    sucursales: Array<{ nombre: string; direccion: string | null; telefono: string | null }>
    horario: Array<{ day: number; start: string; end: string; enabled: boolean }> | null
  }

  test('"¿Dónde están ubicados?" — nombre, dirección y teléfono reales', () => {
    const ficha = campoJson<Ficha>(construir('¿Dónde están ubicados?', memoriaCliente), 'FICHA')
    expect(ficha.nombre).toBe('Estética Bella Vida')
    expect(ficha.direccion).toBe('Av. Providencia 1234, Providencia')
    expect(ficha.telefono).toBe('+56941398290')
  })

  test('"Mándame la ubicación." — el maps_url exacto está disponible', () => {
    const ficha = campoJson<Ficha>(construir('Mándame la ubicación.', memoriaCliente), 'FICHA')
    expect(ficha.mapsUrl).toBe('https://maps.app.goo.gl/ejemplo-bella-vida')
  })

  test('las sucursales y el horario del negocio también viajan', () => {
    const ficha = campoJson<Ficha>(construir('¿A qué hora abren?', memoriaCliente), 'FICHA')
    expect(ficha.zona).toBe(ZONA)
    expect(ficha.sucursales).toHaveLength(1)
    expect(ficha.sucursales[0].nombre).toBe('Sucursal Centro')
    expect(ficha.horario).not.toBeNull()
    expect(ficha.horario?.find((dia) => dia.day === 7)?.enabled).toBe(false)
    expect(ficha.horario?.find((dia) => dia.day === 6)?.end).toBe('14:00')
  })

  test('un negocio sin dirección ni maps_url no rompe la plantilla', () => {
    const sinDatos = {
      json: { ...memoriaCliente, ...catalogo, business: { ...catalogo.business, address: '', maps_url: '', settings: {} }, branches: [] },
      nodos: { Entrada: entrada('¿Dónde están?'), Agrupar: agrupar('¿Dónde están?') },
    }
    const ficha = campoJson<Ficha>(contextoDelAgente(sinDatos), 'FICHA')
    expect(ficha.direccion).toBe('')
    expect(ficha.sucursales).toEqual([])
    expect(ficha.horario).toBeNull()
  })
})
