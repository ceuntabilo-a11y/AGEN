/**
 * Datos de prueba con la forma EXACTA que devuelven los endpoints del agente.
 *
 * No son inventados: `catalogo` se copió de una respuesta real de
 * `POST /api/agent/catalog` contra el tenant sandbox (Estética Bella Vida), y
 * `memoriaEquipo` / `memoriaCliente` reproducen las dos ramas de
 * `src/app/api/agent/memory/route.ts`. Se completan `address` y `maps_url`, que en el
 * sandbox están vacíos, para poder comprobar que el dato viaja cuando existe.
 */

export const ZONA = 'America/Santiago'

export const catalogo = {
  business: {
    id: '4cb0d138-6180-4842-8a88-1f633b08de5c',
    name: 'Estética Bella Vida',
    timezone: ZONA,
    currency: 'CLP',
    address: 'Av. Providencia 1234, Providencia',
    phone: '+56941398290',
    maps_url: 'https://maps.app.goo.gl/ejemplo-bella-vida',
    settings: {
      business_hours: [
        { day: 1, start: '09:00', end: '19:00', enabled: true },
        { day: 2, start: '09:00', end: '19:00', enabled: true },
        { day: 3, start: '09:00', end: '19:00', enabled: true },
        { day: 4, start: '09:00', end: '19:00', enabled: true },
        { day: 5, start: '09:00', end: '19:00', enabled: true },
        { day: 6, start: '09:00', end: '14:00', enabled: true },
        { day: 7, start: '09:00', end: '19:00', enabled: false },
      ],
    },
    agent_settings: {},
  },
  branches: [
    { id: 'suc-1', name: 'Sucursal Centro', address: 'Huérfanos 500', phone: '+56922222222', timezone: ZONA },
  ],
  specialties: [
    { id: 'esp-pelo', name: 'Peluquería y Estilismo', slug: 'peluqueria-estilismo', description: null, color: '#5b3df5' },
    { id: 'esp-manos', name: 'Manicura y Pedicura', slug: 'manicura-pedicura', description: null, color: '#f55b8d' },
  ],
  services: [
    {
      id: 'f523667e-73b6-4021-aac4-590aa0225606',
      name: 'Coloración Completa',
      description: null,
      duration_minutes: 120,
      price: 38000,
      deposit_amount: 0,
      specialty: { id: 'esp-pelo', name: 'Peluquería y Estilismo', slug: 'peluqueria-estilismo' },
    },
    {
      id: 'svc-manicura',
      name: 'Manicura Semipermanente',
      description: null,
      duration_minutes: 50,
      price: 14000,
      deposit_amount: 0,
      specialty: { id: 'esp-manos', name: 'Manicura y Pedicura', slug: 'manicura-pedicura' },
    },
    {
      id: 'svc-pedicura',
      name: 'Pedicura Spa',
      description: null,
      duration_minutes: 60,
      price: 18000,
      deposit_amount: 0,
      specialty: { id: 'esp-manos', name: 'Manicura y Pedicura', slug: 'manicura-pedicura' },
    },
  ],
}

/** Rama TEAM de /api/agent/memory (cuando el teléfono es de un profesional o del equipo). */
export const memoriaEquipo = {
  known: true,
  actorType: 'TEAM',
  teamMember: {
    actorType: 'TEAM',
    kind: 'PROFESSIONAL',
    id: 'miembro-1',
    name: 'Camila Rojas',
    role: 'PROFESSIONAL',
    professionalId: 'prof-camila',
  },
  today: [
    {
      id: 'cita-1',
      status: 'CONFIRMED',
      // 2026-08-10 10:00 en Santiago (UTC−4) = 14:00Z
      service_period: '["2026-08-10T14:00:00+00:00","2026-08-10T14:50:00+00:00")',
      client: { full_name: 'Josefa Fuentes', phone: '56911112222' },
      professional: { display_name: 'Camila Rojas' },
      service: { name: 'Manicura Semipermanente' },
    },
    {
      id: 'cita-2',
      status: 'PENDING',
      // 2026-08-10 16:30 en Santiago = 20:30Z
      service_period: '["2026-08-10T20:30:00+00:00","2026-08-10T21:30:00+00:00")',
      client: { full_name: 'Trinidad Silva', phone: '56933334444' },
      professional: { display_name: 'Camila Rojas' },
      service: { name: 'Pedicura Spa' },
    },
  ],
  waiting: 3,
  followups: 2,
  timezone: ZONA,
}

/** Rama CLIENT de /api/agent/memory para alguien ya registrado y sin reservas. */
export const memoriaCliente = {
  known: true,
  actorType: 'CLIENT',
  client: {
    id: 'cli-1',
    full_name: 'Josefa Fuentes',
    phone: '56911112222',
    email: null,
    birthday: null,
    notes: null,
    marketing_opt_in: false,
    client_memory: [],
  },
  appointments: [],
}

/** Item que llega al nodo del agente: memoria y catálogo ya unidos por el nodo Merge. */
export const contextoUnido = (memoria: Record<string, unknown>) => ({ ...memoria, ...catalogo })

/** Salida del nodo "Entrada" para un mensaje concreto. */
export const entrada = (mensaje: string, telefono = '56911112222') => ({
  body: {
    businessId: catalogo.business.id,
    phone: telefono,
    message: mensaje,
    sender: 'perfil de whatsapp',
  },
  messageKey: { id: 'MSG-1' },
})

/** Salida del nodo "Agrupar" (mensajes fusionados tras el debounce). */
export const agrupar = (mensaje: string) => ({ claim: true, message: mensaje })
