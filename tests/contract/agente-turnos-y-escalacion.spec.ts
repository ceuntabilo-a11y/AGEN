import { test, expect } from '@playwright/test'
import { cargarWorkflow, promptDelSistema } from '../support/n8n'
import { textoEquipoAvisado } from '@/lib/agent-textos'

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

  /*
   * Regresión real, ejecución 9343 del n8n de producción, provocada por reescribir el prompt en
   * pasos numerados: a "Tienes hora para manicura mañana?" el agente llamó buscar_horarios y
   * acto seguido crear_reserva, y le contestó al cliente "te reservé Manicura Semipermanente…".
   * Una pregunta por disponibilidad se convirtió en una reserva que nadie pidió.
   *
   * La regla que lo cierra es de turno, no de intención: buscar y reservar no pueden ocurrir en
   * el mismo turno, porque entre las dos cosas tiene que caber un mensaje del cliente eligiendo.
   */
  /*
   * Ahora esto no depende del prompt: la rama que busca horarios NO tiene ninguna herramienta
   * capaz de reservar, y reservar exige un apartado creado en un turno anterior. Aun así la
   * regla sigue escrita, porque el modelo tampoco puede DECIR que reservó.
   */
  test('preguntar por horarios no puede convertirse en una reserva', () => {
    expect(prompt).toContain('NO puedes reservar')
    expect(prompt).toContain('Preguntar por horarios NO es reservar')
  })

  test('el precio no se ofrece solo: se da cuando lo piden', () => {
    expect(prompt).toContain('EL PRECIO NO SE DA SI NO LO PIDEN')
    expect(prompt).toContain('Solo lo escribes cuando el cliente pregunta')
  })

  test('un día de la semana a secas no se pregunta: se resuelve', () => {
    /*
     * Observado en producción: a "quiero hora para Corte y Peinado el martes en la tarde" el
     * agente contestó "¿te refieres al martes 18 de agosto por la tarde?" en vez de ofrecer
     * horarios. Un turno entero gastado en confirmar algo que el contexto ya resuelve:
     * `TIEMPO.proximos.martes` es siempre futuro y no admite dos lecturas.
     */
    expect(prompt).toContain('TIEMPO.proximos')
    expect(prompt).toContain('NO es ambiguo')
    expect(prompt).toContain('ofrece directamente los horarios')
  })

  test('"en la mañana" y "en la tarde" se filtran, no se preguntan', () => {
    expect(prompt).toContain('filtra por el campo franja')
    expect(prompt).toContain('no estreches la búsqueda ni preguntes a qué hora')
  })

  test('el modelo no convierte horas: copia las que le da la herramienta', () => {
    // Se le prohibió explícitamente después de verlo fallar en producción: con horarios de las
    // 09:00 locales dijo "el martes 17 a las 13:00", y el 17 era lunes.
    expect(prompt).toContain('no conviertas horas por tu cuenta')
    expect(prompt).toContain('dia, hora y franja YA resueltos')
  })
})

/*
 * Avisar al equipo dejó de ser una herramienta del modelo.
 *
 * Antes el modelo decidía por su cuenta si llamaba `avisar_al_equipo`, y la frase "ya le avisé
 * al equipo" dependía de que quisiera hacerlo. Ahora la intención ESCALAR la resuelve el router
 * y la ejecuta `/api/agent/act`, que además redacta la respuesta según lo que de verdad pasó:
 * el modelo ya no puede prometer un aviso que no ocurrió.
 */
test.describe('P4 — avisar al equipo tiene que ocurrir de verdad', () => {
  test('la escalación la ejecuta código, no una herramienta del modelo', () => {
    expect(workflow.nodes.find((n) => n.name === 'avisar_al_equipo'), 'ya no puede ser una herramienta del modelo').toBeFalsy()
    const ejecutor = workflow.nodes.find((n) => n.name === 'Ejecutar acción')!
    expect(String((ejecutor.parameters as { url: string }).url)).toContain('/api/agent/act')
  })

  test('el texto del aviso lo escribe la app según el resultado real', () => {
    expect(textoEquipoAvisado(true, '+56911112222')).toContain('Ya le avisé al equipo')
    // Sin equipo a quien avisar, se dice la verdad y se da el teléfono del negocio.
    expect(textoEquipoAvisado(false, '+56911112222')).toContain('No pude dejar el aviso')
    expect(textoEquipoAvisado(false, '+56911112222')).toContain('+56911112222')
  })

  test('los motivos que el decisor puede pedir son exactamente los que acepta el ejecutor', () => {
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
