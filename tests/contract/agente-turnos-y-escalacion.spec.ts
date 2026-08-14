import { test, expect } from '@playwright/test'
import { cargarWorkflow, promptDelSistema } from '../support/n8n'

/**
 * Tres conductas del agente observadas en conversaciones reales, y las reglas que las cierran.
 *
 * 1. **Preguntaba demasiado.** La regla decía literalmente "pregunta una sola cosa por
 *    mensaje", así que reservar un corte costaba cinco o seis idas y vueltas y volvía a pedir
 *    datos que el cliente ya había dado.
 * 2. **Prometía avisar al equipo sin avisar a nadie.** Llegó a escribir "¿quieres que avise al
 *    equipo?" cuando no existía ninguna herramienta detrás de esa frase.
 * 3. **Se enredaba con respuestas sueltas** ("ok", "sí", "después", "no sé") y repetía párrafos
 *    enteros.
 *
 * Estas pruebas leen el prompt y el workflow de verdad (`n8n-workflows/01-agen-agent.json`),
 * así que fallan si alguien deshace la regla. No sustituyen a la prueba con el modelo real
 * —eso necesita OpenAI y n8n—, fijan que la instrucción está y que la herramienta existe.
 */

const prompt = promptDelSistema()
const workflow = cargarWorkflow()

test.describe('P3 — una reserva sencilla se cierra en pocos turnos', () => {
  test('ya no existe la regla que causaba el goteo de preguntas', () => {
    expect(prompt).not.toContain('pregunta una sola cosa por mensaje')
  })

  test('lo que el cliente ya dijo no se vuelve a preguntar', () => {
    expect(prompt).toContain('NO se vuelve a preguntar')
    expect(prompt).toContain('dalo por dado')
  })

  test('los datos que falten se piden juntos, no de uno en uno', () => {
    expect(prompt).toContain('JUNTOS en un solo mensaje')
  })

  test('sin preferencia de profesional no se pregunta: se ofrecen horarios', () => {
    expect(prompt).toContain('no expresó preferencia de profesional, no preguntes')
  })

  test('el objetivo de tres intercambios está escrito, no implícito', () => {
    expect(prompt).toContain('tres intercambios')
  })
})

test.describe('P4 — avisar al equipo tiene que ocurrir de verdad', () => {
  test('existe la herramienta avisar_al_equipo y está conectada al agente', () => {
    const herramienta = workflow.nodes.find((n) => n.name === 'avisar_al_equipo')
    expect(herramienta, 'sin herramienta, la frase "aviso al equipo" es mentira').toBeTruthy()
    expect(herramienta!.type).toBe('@n8n/n8n-nodes-langchain.toolCode')
    const conexiones = (JSON.parse(JSON.stringify(
      (workflow as unknown as { connections: Record<string, unknown> }).connections ?? {},
    )) as Record<string, { ai_tool?: { node: string }[][] }>).avisar_al_equipo
    expect(conexiones?.ai_tool?.[0]?.[0]?.node).toBe('Agente Agen')
  })

  test('la herramienta llama al endpoint real de escalación', () => {
    const codigo = String((workflow.nodes.find((n) => n.name === 'avisar_al_equipo')!.parameters as { jsCode: string }).jsCode)
    expect(codigo).toContain('/api/agent/escalate')
    expect(codigo).toContain('businessId')
    expect(codigo).toContain('reason')
  })

  test('está prohibido decir que avisó sin haberlo hecho', () => {
    expect(prompt).toContain('PROHIBIDO decir que vas a avisar')
    expect(prompt).toContain('escalated:true')
  })

  test('si no se pudo avisar, se dice la verdad y se da el teléfono', () => {
    expect(prompt).toContain('escalated:false')
    expect(prompt).toContain('businessPhone')
  })

  test('los motivos del prompt son exactamente los que acepta el endpoint', () => {
    // Si el prompt inventa un motivo, la llamada vuelve con 400 y el cliente se queda esperando.
    for (const motivo of ['PAGO', 'QUEJA', 'SEGURIDAD', 'PETICION_CLIENTE', 'FUERA_DE_ALCANCE']) {
      expect(prompt).toContain(motivo)
    }
  })

  test('ya no queda la instrucción vaga que no ejecutaba nada', () => {
    expect(prompt).not.toContain('Transfiere a una persona ante pagos')
    expect(prompt).not.toContain('ofrece comunicarlos con una persona del equipo')
  })
})

test.describe('P5 — ambigüedad y bucles', () => {
  test('las respuestas sueltas de aceptación continúan lo último propuesto', () => {
    for (const palabra of ['"ok"', '"sí"', '"dale"', '"hazlo"', '"inténtalo"']) {
      expect(prompt).toContain(palabra)
    }
    expect(prompt).toContain('acepta LO ÚLTIMO que le propusiste')
  })

  test('"después" no se insiste y "no sé" lo decide el agente', () => {
    expect(prompt).toContain('"después"')
    expect(prompt).toContain('no insistas')
    expect(prompt).toContain('"no sé"')
    expect(prompt).toContain('propón la opción más razonable')
  })

  test('hay un límite explícito de reintentos de la misma pregunta', () => {
    expect(prompt).toContain('dos veces sin obtener el dato')
    expect(prompt).toContain('no lo preguntes una tercera')
  })

  test('no se repiten párrafos ni se reenvía el catálogo entero', () => {
    expect(prompt).toContain('Nunca reenvíes un párrafo que ya mandaste')
  })

  test('una herramienta no se llama dos veces con los mismos datos', () => {
    expect(prompt).toContain('UNA HERRAMIENTA, UNA VEZ')
  })
})
