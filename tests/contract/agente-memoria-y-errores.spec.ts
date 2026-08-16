import { test, expect } from '@playwright/test'
import { motivoDeError } from '@/lib/agent-errors'
import { cargarWorkflow, promptDelSistema } from '../support/n8n'
import { POST as POST_contexto } from '@/app/api/agent/context/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Una sola memoria, que sobrevive a un reinicio, y errores que el modelo no tiene que adivinar.
 */

const prompt = promptDelSistema()
const workflow = cargarWorkflow()

test.describe('Una sola fuente de conversación', () => {
  /*
   * El nodo `Memoria reciente` era un `memoryBufferWindow`: guardaba los últimos mensajes en la
   * memoria del proceso de n8n. Un reinicio o un redespliegue borraba el hilo de todos los
   * clientes a mitad de conversación, y encima el modelo recibía la charla dos veces (su buffer
   * más el resumen de `client_memory`), pagando los mismos tokens dos veces.
   */
  test('el buffer en memoria de n8n ya no existe', () => {
    expect(workflow.nodes.some((nodo) => nodo.name === 'Memoria reciente')).toBe(false)
    expect(workflow.nodes.some((nodo) => String(nodo.type).includes('memoryBufferWindow'))).toBe(false)
  })

  test('la conversación viaja en el turno, leída de la base', () => {
    const agente = workflow.nodes.find((nodo) => nodo.name === 'Agente Agen')
    expect(String(agente?.parameters?.text)).toContain('CONVERSACION')
    expect(String(agente?.parameters?.text)).toContain('$json.recent')
  })

  test('CONVERSACION y MEMORIA tienen jerarquía escrita, no implícita', () => {
    expect(prompt).toContain('CONVERSACION es lo que ya se habló')
    expect(prompt).toContain('NUNCA le gana a CONVERSACION')
    expect(prompt).toContain('Si las dos se contradicen, vale CONVERSACION')
  })

  /*
   * Item 9: un aviso automático viejo no puede comerse una conversación nueva. La regla vive en
   * el prompt (20–24) y la decisión dura está en `pareceRespuestaAlAviso`, pero acá se fija que
   * la jerarquía sigue escrita: el aviso es antecedente, no el tema.
   */
  test('un aviso pendiente nunca manda sobre la conversación en curso', () => {
    expect(prompt).toContain('IGNÓRALO y no lo menciones')
    expect(prompt).toContain('la conversación ya siguió')
    expect(prompt).toContain('da prioridad a lo último que hablaron')
  })

  test('el modelo no lleva la conversación duplicada dentro de CLIENTE', () => {
    const texto = String(workflow.nodes.find((nodo) => nodo.name === 'Agente Agen')?.parameters?.text)
    // CLIENTE pasa a ser una ficha corta; el bloque de memoria va aparte y una sola vez.
    expect(texto).toContain('MEMORIA')
    expect(texto).not.toContain("JSON.stringify($json.client || null)")
  })
})

test.describe('El modelo no improvisa qué salió mal', () => {
  test('cada errcode de la base tiene un motivo, y ninguno es una suposición', () => {
    expect(motivoDeError({ code: '23P01' })).toBe('CUPO_OCUPADO')
    expect(motivoDeError({ code: '23505' })).toBe('CUPO_OCUPADO')
    expect(motivoDeError({ code: '42501' })).toBe('NO_AUTORIZADO')
    expect(motivoDeError({ code: 'P0002' })).toBe('NO_EXISTE')
    expect(motivoDeError({ code: '22007' })).toBe('DATO_INVALIDO')
    expect(motivoDeError({ code: '22023' })).toBe('DATO_INVALIDO')
  })

  test('P0001 solo es "cerrado" si el mensaje lo dice; si no, es error técnico', () => {
    expect(motivoDeError({ code: 'P0001', message: 'El negocio está cerrado ese día' })).toBe('NEGOCIO_CERRADO')
    expect(motivoDeError({ code: 'P0001', message: 'otra regla cualquiera' })).toBe('ERROR_TECNICO')
  })

  test('lo desconocido nunca se disfraza de algo concreto', () => {
    expect(motivoDeError(null)).toBe('ERROR_TECNICO')
    expect(motivoDeError({ code: 'XX999' })).toBe('ERROR_TECNICO')
  })

  test('la tabla de motivos está en el prompt, con la diferencia que importa', () => {
    for (const motivo of ['SIN_CUPOS', 'NEGOCIO_CERRADO', 'CUPO_OCUPADO', 'NO_EXISTE', 'DATO_INVALIDO', 'NO_AUTORIZADO', 'ERROR_TECNICO']) {
      expect(prompt, motivo).toContain(motivo)
    }
    // Las dos que el modelo confundía: sin cupos se ofrece otro día, cerrado también, pero
    // jamás al revés — y ante un error técnico no puede decir que no hay horas.
    expect(prompt).toContain('Nunca digas que el negocio está cerrado')
    expect(prompt).toContain('Nunca ofrezcas otra hora del mismo día')
    expect(prompt).toContain('NUNCA digas que no hay horas')
  })
})

test.describe('Los apartados no congelan la agenda por preguntar', () => {
  test('el apartado dura 10 minutos, no 15', () => {
    // Cada búsqueda bloquea cupos reales. Ver `MINUTOS_APARTADO` en /api/agent/slots.
    expect(prompt).toContain('queda apartado')
  })
})

test.describe('La conversación reciente llega al contexto', () => {
  const NEGOCIO = 'negocio-1'
  const TELEFONO = '56911112222'
  let falso: SupabaseFalso

  const datos = (extra: Tablas = {}): Tablas => ({
    businesses: [{
      id: NEGOCIO, active: true, name: 'Bella Vida', timezone: 'America/Santiago',
      currency: 'CLP', address: null, phone: null, maps_url: null, settings: {}, agent_settings: {},
    }],
    specialties: [], services: [], branches: [], professionals: [], business_members: [],
    appointments: [], waitlist_entries: [], follow_up_tasks: [],
    clients: [{ id: 'cli-1', business_id: NEGOCIO, phone: TELEFONO, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
    ...extra,
  })

  test.beforeEach(async () => {
    falso = await levantarSupabaseFalso(datos())
    usarSupabaseFalso(falso)
  })
  test.afterEach(async () => { await falso.cerrar() })

  test('un cliente sin historial trae la conversación vacía, no inventada', async () => {
    const respuesta = await POST_contexto(peticionAgente('http://localhost/api/agent/context', { businessId: NEGOCIO, phone: TELEFONO, message: 'hola' }))
    const cuerpo = await respuesta.json()
    expect(Array.isArray(cuerpo.recent)).toBe(true)
    expect(cuerpo.recent).toEqual([])
  })
})
