import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { POST as TURNO } from '@/app/api/agent/turn/route'
import { lineaDeTono } from '@/lib/agent-router'
import { textoDeTransferencia } from '@/lib/agent-escalation'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso, type Tablas } from '../support/supabase-fake'

/**
 * Los interruptores de `/admin/agente` tienen que hacer algo.
 *
 * Los tres que había estaban conectados a nada: se guardaban en `agent_settings` y ahí se
 * quedaban. Es peor que no tenerlos, porque el dueño cree que ya ajustó algo:
 *
 *  - «Agente habilitado» apagado → el agente seguía contestando igual. Un negocio que se iba de
 *    vacaciones seguía tomando reservas.
 *  - «Tono» → no cambiaba una sola palabra de lo que escribía.
 *  - «Permitir transferir a una persona» → no existía ningún número ni ningún envío.
 *  - La pestaña «Prompt» dejaba escribir instrucciones que contradecían a las del agente… y
 *    tampoco las leía nadie.
 */

const NEGOCIO = 'neg-1'
const ANA = '56911112222'

let falso: SupabaseFalso
let claveOpenAi: string | undefined

const datos = (agentSettings: Record<string, unknown> = {}): Tablas => ({
  businesses: [{
    id: NEGOCIO, active: true, name: 'Bella Vida', timezone: 'America/Santiago', currency: 'CLP',
    address: null, phone: '+56941398290', maps_url: null, settings: {},
    agent_settings: agentSettings, openai_api_key: null,
    feature_image: false, feature_voice: false,
    whatsapp_provider: 'EVOLUTION', whatsapp_instance: 'Agen',
  }],
  specialties: [], services: [], professionals: [], branches: [], business_members: [],
  clients: [{ id: 'cli-ana', business_id: NEGOCIO, phone: ANA, full_name: 'Ana Pérez', email: null, birthday: null, notes: null, marketing_opt_in: false }],
  appointments: [], appointment_holds: [], conversations: [], messages: [],
  waitlist_entries: [], follow_up_tasks: [], platform_settings: [], outbound_prompts: [],
  portfolio_items: [], survey_responses: [], agent_inbox: [],
})

const turno = async (message: string) => {
  const respuesta = await TURNO(peticionAgente('http://localhost/api/agent/turn', { businessId: NEGOCIO, phone: ANA, message }))
  return await respuesta.json() as Record<string, any>
}

const levantar = async (agentSettings: Record<string, unknown> = {}) => {
  falso = await levantarSupabaseFalso(datos(agentSettings))
  usarSupabaseFalso(falso)
}

test.beforeEach(() => {
  claveOpenAi = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
})

test.afterEach(async () => {
  if (claveOpenAi === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = claveOpenAi
  await falso?.cerrar()
})

test.describe('«Agente habilitado» apaga el agente de verdad', () => {
  test('apagado, el turno no llega a ningún modelo y no se contesta nada', async () => {
    await levantar({ enabled: false })
    const cuerpo = await turno('hola, quiero una hora')
    expect(cuerpo.ruta).toBe('APAGADO')
    expect(cuerpo.texto, 'apagado significa que nadie le contesta').toBeNull()
    expect(cuerpo.systemMessage).toBe('')
  })

  test('encendido, el turno sigue su camino normal', async () => {
    await levantar({ enabled: true })
    expect((await turno('hola')).ruta).not.toBe('APAGADO')
  })

  test('sin configurar, el agente NO se apaga solo', async () => {
    // Los negocios que nunca tocaron el interruptor tienen que seguir funcionando igual.
    await levantar({})
    expect((await turno('hola')).ruta).not.toBe('APAGADO')
  })

  test('el equipo sigue pudiendo consultar aunque esté apagado para clientes', async () => {
    await levantar({ enabled: false })
    falso.tablas.professionals = [{ id: 'pro-1', business_id: NEGOCIO, active: true, display_name: 'Fernanda', phone: ANA, member_id: 'mem-1' }]
    expect((await turno('¿cómo va la agenda?')).ruta).not.toBe('APAGADO')
  })

  test('el workflow tiene su salida: contesta al webhook y no manda mensaje', () => {
    const workflow = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'n8n-workflows', '01-agen-agent.json'), 'utf8')) as {
      nodes: Array<Record<string, any>>
      connections: Record<string, { main?: Array<Array<{ node: string }>> }>
    }
    const salida = workflow.nodes.find((nodo) => nodo.name === 'Agente apagado')
    expect(salida?.type).toBe('n8n-nodes-base.respondToWebhook')
    // Y esa rama no puede acabar enviando nada por WhatsApp.
    expect(workflow.connections['Agente apagado']).toBeUndefined()
    expect(workflow.connections['¿Agente apagado?'].main?.[0]?.[0]?.node).toBe('Agente apagado')
  })
})

test.describe('«Tono» cambia de verdad cómo escribe', () => {
  for (const [tono, senal] of [
    ['professional', 'Sin emojis'],
    ['brief', 'máximo 3 líneas'],
    ['friendly', 'cálido'],
  ] as Array<[string, string]>) {
    test(`el tono "${tono}" llega al modelo`, async () => {
      await levantar({ enabled: true, tone: tono })
      expect((await turno('¿qué servicios tienen?')).systemMessage).toContain(senal)
    })
  }

  test('un tono desconocido no ensucia las instrucciones', () => {
    expect(lineaDeTono('inventado')).toBeNull()
    expect(lineaDeTono(null)).toBeNull()
  })
})

test.describe('Transferir a una persona: el aviso que se manda', () => {
  test('lleva quién, por qué y qué dijo', () => {
    const texto = textoDeTransferencia({
      clientName: 'Ana Pérez', clientPhone: ANA, motivo: 'PAGO',
      detalle: 'Hice la transferencia ayer y no me llega la confirmación',
      businessName: 'Bella Vida',
    })
    expect(texto).toContain('Ana Pérez')
    expect(texto).toContain(ANA)
    expect(texto).toContain('consulta de pago')
    expect(texto).toContain('transferencia ayer')
    expect(texto).toContain('Bella Vida')
  })

  test('sin nombre del cliente sigue siendo entendible', () => {
    const texto = textoDeTransferencia({ clientPhone: ANA, motivo: 'QUEJA', detalle: 'estoy molesta' })
    expect(texto).toContain('Un cliente')
    expect(texto).toContain('un reclamo')
  })

  test('cada motivo se explica en palabras, no en mayúsculas internas', () => {
    for (const motivo of ['PAGO', 'QUEJA', 'SEGURIDAD', 'PETICION_CLIENTE', 'FUERA_DE_ALCANCE'] as const) {
      const texto = textoDeTransferencia({ clientPhone: ANA, motivo, detalle: 'algo' })
      expect(texto, motivo).not.toContain(motivo)
    }
  })
})

test.describe('La pestaña del prompt ya no existe', () => {
  const pagina = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'admin', 'agente', 'page.tsx'), 'utf8')

  test('no se puede escribir un prompt que contradiga al agente', () => {
    expect(pagina).not.toContain('promptExtra')
    expect(pagina).not.toContain("'Prompt'")
  })

  test('el botón de guardar dice que está guardando y confirma', () => {
    expect(pagina).toContain('Guardando…')
    expect(pagina).toContain('Configuración guardada y aplicada')
  })

  test('el número de transferencia se configura sin salir de la página', () => {
    expect(pagina).toContain('Configurar número')
    // El modal accesible (role="dialog", aria-modal, Escape, X para cerrar) lo da ModalShell.
    expect(pagina).toContain('ModalShell')
    expect(pagina).toContain('handoff_phone')
  })

  test('y se explica para qué sirve y qué se manda', () => {
    expect(pagina).toContain('Qué hace:')
    expect(pagina).toContain('Qué le llega:')
    expect(pagina).toContain('Un número por negocio')
  })
})
