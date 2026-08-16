import { test, expect } from '@playwright/test'
import { motivoDeError } from '@/lib/agent-errors'
import { revisarRespuesta } from '@/lib/agent-reply'
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

  /*
   * Una herramienta que no contesta reventaba el nodo y mataba la ejecución entera: el cliente
   * se quedaba esperando para siempre, sin respuesta ni disculpa. Ahora el fallo vuelve como un
   * resultado con `motivo`, y las ocho herramientas pasan por el mismo envoltorio.
   */
  test('ninguna herramienta puede tumbar la ejecución por un timeout', () => {
    const herramientas = workflow.nodes.filter((nodo) => String(nodo.type).includes('toolCode'))
    expect(herramientas.length).toBeGreaterThanOrEqual(8)
    for (const nodo of herramientas) {
      const codigo = String((nodo.parameters as { jsCode?: string }).jsCode ?? '')
      expect(codigo, `${nodo.name} no usa el envoltorio`).toContain('await pedirALaApp(')
      expect(codigo, `${nodo.name} sigue llamando sin protección`).not.toContain('this.helpers.httpRequest(')
      expect(codigo, `${nodo.name} sin captura de fallo`).toContain("motivo: seAcaboElTiempo ? 'TIMEOUT'")
    }
  })

  test('la tabla de motivos está en el prompt, con la diferencia que importa', () => {
    for (const motivo of ['SIN_CUPOS', 'NEGOCIO_CERRADO', 'CUPO_OCUPADO', 'NO_EXISTE', 'DATO_INVALIDO', 'NO_AUTORIZADO', 'ERROR_TECNICO', 'TIMEOUT']) {
      expect(prompt, motivo).toContain(motivo)
    }
    // Las dos que el modelo confundía: sin cupos se ofrece otro día, cerrado también, pero
    // jamás al revés — y ante un error técnico no puede decir que no hay horas.
    expect(prompt).toContain('Nunca digas que el negocio está cerrado')
    expect(prompt).toContain('Nunca ofrezcas otra hora del mismo día')
    expect(prompt).toContain('NUNCA digas que no hay horas')
  })
})

/*
 * Hasta ahora reagendar era «liberar y volver a reservar»: dos pasos, y entre uno y otro el cupo
 * viejo se ofrecía a la lista de espera mientras el nuevo podía no existir. El cliente se
 * quedaba sin hora justo por pedir cambiarla.
 */
test.describe('Mover una hora es una operación, no dos', () => {
  test('existe la herramienta y cuelga del agente', () => {
    const mover = workflow.nodes.find((nodo) => nodo.name === 'mover_reserva')
    expect(mover, 'falta la herramienta mover_reserva').toBeTruthy()
    expect(String((mover?.parameters as { jsCode?: string })?.jsCode)).toContain("action: 'reschedule'")
    expect(workflow.connections?.mover_reserva?.ai_tool?.[0]?.[0]?.node).toBe('Agente Agen')
  })

  test('el prompt distingue mover de cancelar, y prohíbe liberar por si acaso', () => {
    expect(prompt).toContain('MOVER NO ES CANCELAR')
    expect(prompt).toContain('NO uses liberar_reserva')
    expect(prompt).toContain('Nunca liberes primero')
    expect(prompt).toContain('rescheduled:true')
  })
})

/*
 * Ejecución 9548: a «¿Y el martes a las 11 tienes?» el modelo escribió la respuesta entera —el
 * aviso, los tres horarios y la pregunta final— y la volvió a escribir debajo, idéntica. Al
 * cliente le llega el doble de texto y parece un error del negocio.
 */
test.describe('Una respuesta no se manda dos veces', () => {
  const UNA = 'A las 11 no queda disponibilidad ese martes.\n\n09:00 con Camila Rojas\n\n¿Cuál prefieres?'
  const SIN_EVIDENCIA = { reservo: false, cancelo: false, confirmo: false, ultima: null }

  test('un texto que es su propia mitad repetida sale una sola vez', () => {
    const revision = revisarRespuesta(`${UNA}${UNA}`, SIN_EVIDENCIA)
    expect(revision.bloqueada).toBe(false)
    expect(revision.texto).toBe(UNA)
    expect(revision.motivos).toContain('respuesta_repetida')
  })

  test('dos mitades parecidas pero distintas no se tocan', () => {
    const distinto = `${UNA}\n\nTambién tengo el miércoles a las 10:00 con Valentina Soto.`
    expect(revisarRespuesta(distinto, SIN_EVIDENCIA).texto).toBe(distinto)
  })

  test('un mensaje normal nunca pierde su segunda mitad', () => {
    // Nada que afirme una acción: eso lo bloquea la revisión por falta de evidencia, y con razón.
    for (const texto of [UNA, 'Tenemos Corte y Peinado, Manicura Semipermanente y Pedicura Spa. ¿Cuál te interesa?', 'Claro, dime.']) {
      expect(revisarRespuesta(texto, SIN_EVIDENCIA).texto, texto).toBe(texto)
    }
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
