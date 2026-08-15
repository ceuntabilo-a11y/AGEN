import { test, expect } from '@playwright/test'
import { RESPALDO_SEGUN_ACCION, RESPUESTA_DE_RESPALDO, pareceOtroIdioma, pareceRazonamiento, recortarEnRazonamiento, revisarRespuesta } from '@/lib/agent-reply'

/**
 * El modelo pensando en voz alta delante del cliente.
 *
 * Ocurrió de verdad, en una conversación real por WhatsApp: ante un "Ok" suelto, el agente
 * respondió con su propio razonamiento —en inglés, citando sus reglas por número y sus
 * herramientas por nombre— en vez de con una respuesta. Empezaba así:
 *
 *   «Hay varios pasos here. Clarify: We must respond in Spanish and per rules.
 *    The user said "Ok" … We need to call buscar_horarios again properly.»
 *
 * El prompt ya lo prohibía. El prompt no lo garantiza: esta capa corre en la app, antes de
 * enviar, y no depende de la buena conducta del modelo.
 *
 * La otra mitad, igual de importante: que esto no bloquee respuestas legítimas. Un mensaje
 * normal en español, aunque lleve una palabra en inglés o un número, tiene que salir.
 */

const sinEvidencia = { reservo: false, cancelo: false, confirmo: false }

/** El caso real, recortado. */
const FUGA_REAL = 'Hay varios pasos here. Clarify: We must respond in Spanish and per rules. '
  + 'The user said "Ok" — which previously we asked "¿Quieres que te busque otro horario?" '
  + 'We need to call buscar_horarios again properly. We should present options.'

test.describe('Un volcado de razonamiento no llega al cliente', () => {
  test('el caso exacto que se vio en producción se bloquea', () => {
    const revision = revisarRespuesta(FUGA_REAL, sinEvidencia)
    expect(revision.bloqueada).toBe(true)
    expect(revision.texto).toBe(RESPUESTA_DE_RESPALDO)
    expect(revision.motivos).toContain('razonamiento_del_modelo')
  })

  test('nombrar una herramienta propia basta para bloquear', () => {
    for (const herramienta of ['buscar_horarios', 'crear_reserva', 'mis_reservas', 'confirmar_reserva', 'liberar_reserva', 'avisar_al_equipo']) {
      expect(pareceRazonamiento(`Voy a usar ${herramienta} para eso`), herramienta).toBe(true)
    }
  })

  test('citar sus propias reglas también', () => {
    expect(pareceRazonamiento('Según la regla 17 debo continuar')).toBe(true)
    expect(pareceRazonamiento('Aplicando la REGLA DE SALIDA respondo')).toBe(true)
  })

  test('devolver el andamio del contexto se bloquea', () => {
    // Si salen las etiquetas del contexto inyectado, salió el mensaje entero del sistema.
    const revision = revisarRespuesta('MENSAJE: "hola"\nNEGOCIO: Bella Vida\nRESERVAS: []', sinEvidencia)
    expect(revision.bloqueada).toBe(true)
  })

  test('la deliberación en primera persona del plural se bloquea', () => {
    expect(pareceRazonamiento('We must respond in Spanish')).toBe(true)
    expect(pareceRazonamiento('The user said ok, so we should proceed')).toBe(true)
  })
})

test.describe('Responder en otro idioma se bloquea', () => {
  test('una respuesta en inglés no se le manda a un cliente chileno', () => {
    const revision = revisarRespuesta(
      'The user should choose one of the available slots and then we will confirm the appointment because there is no other option',
      sinEvidencia,
    )
    expect(revision.bloqueada).toBe(true)
    expect(revision.motivos).toContain('idioma_incorrecto')
  })

  test('una palabra suelta en inglés NO bloquea nada', () => {
    // El catálogo real tiene servicios con nombres en inglés: bloquear por eso sería peor.
    expect(pareceOtroIdioma('Tenemos Lifting de Pestañas a las 10:00, ¿te sirve?')).toBe(false)
    expect(pareceOtroIdioma('El look que quieres queda con el Corte y Peinado')).toBe(false)
  })
})

test.describe('Antes de tirar la respuesta, quedarse con la parte buena', () => {
  /*
   * El caso real, dos veces en producción y las dos tras cancelar: el modelo escribe la
   * contestación correcta y LUEGO añade su deliberación, pegada al signo de cierre y sin
   * espacio. Tirar todo era seguro pero cambiaba una respuesta perfectamente buena por un
   * respaldo genérico.
   */
  const REAL = 'He cancelado tu Diseño de Cejas con Henna del lunes 17 de agosto a las 09:30 con '
    + 'Isidora Castro. ¿Quieres que busque otros horarios para ese servicio?Como assistant, we '
    + 'must respond in Spanish, one emoji max, short. We followed tool calls.'

  const conCancelacion = { reservo: false, cancelo: true, confirmo: false, ultima: 'cancelo' as const }

  test('se envía la parte limpia y no el respaldo genérico', () => {
    const revision = revisarRespuesta(REAL, conCancelacion)
    expect(revision.bloqueada).toBe(false)
    expect(revision.texto).toContain('He cancelado tu Diseño de Cejas')
    expect(revision.texto).toContain('¿Quieres que busque otros horarios')
    expect(revision.motivos).toContain('razonamiento_recortado')
  })

  test('lo recortado no llega al cliente', () => {
    const revision = revisarRespuesta(REAL, conCancelacion)
    expect(revision.texto).not.toContain('assistant')
    expect(revision.texto).not.toContain('we must')
    expect(revision.texto).not.toContain('tool calls')
  })

  test('corta aunque el andamio venga pegado al signo de cierre, sin espacio', () => {
    expect(recortarEnRazonamiento('Listo, cancelé la hora de las 10:00.We must respond in Spanish.'))
      .toBe('Listo, cancelé la hora de las 10:00.')
  })

  test('un retazo del propio andamio no se cuela como respuesta', () => {
    // «Hay varios pasos here.» pasaba el corte por longitud y no es una respuesta: es basura
    // corta. Una frase escrita para un cliente lleva varias palabras funcionales en español.
    expect(recortarEnRazonamiento('Hay varios pasos here. Clarify: We must respond in Spanish.')).toBeNull()
  })

  test('si el texto empieza contaminado no se recorta: no hay parte buena', () => {
    expect(recortarEnRazonamiento('We must respond in Spanish. Listo, cancelé tu hora.')).toBeNull()
  })

  test('un trozo demasiado corto no se envía: mejor el respaldo', () => {
    // "Ok." no es una respuesta; el respaldo al menos está escrito para una persona.
    expect(recortarEnRazonamiento('Ok. We must respond in Spanish now.')).toBeNull()
  })

  test('la parte limpia se vuelve a revisar: no basta con recortar', () => {
    // Afirma una cancelación que la base no respalda: recortar no puede convertir eso en válido.
    const revision = revisarRespuesta(
      'Listo, cancelé tu hora del lunes. We must respond in Spanish.',
      sinEvidencia,
    )
    expect(revision.bloqueada).toBe(true)
    expect(revision.motivos).toContain('cancelacion_sin_evidencia')
  })
})

test.describe('Bloquear el texto no es deshacer lo que ya pasó', () => {
  /*
   * Pasó en producción: el cliente pidió cancelar, la hora se canceló DE VERDAD en la base, y
   * el texto del modelo salió con su razonamiento dentro. La revisión lo bloqueó —bien— y le
   * mandó "no pude completar eso" —mal—: la hora estaba cancelada. Decirle que algo falló
   * cuando sí ocurrió es tan dañino como lo contrario, y encima le hace insistir.
   */
  const bloqueable = 'We must respond in Spanish. The user said cancel, so we should call liberar_reserva.'

  test('si la base dice que se canceló, el respaldo lo dice también', () => {
    const revision = revisarRespuesta(bloqueable, { reservo: false, cancelo: true, confirmo: false, ultima: 'cancelo' })
    expect(revision.bloqueada).toBe(true)
    expect(revision.texto).toBe(RESPALDO_SEGUN_ACCION.cancelo)
    expect(revision.texto).not.toBe(RESPUESTA_DE_RESPALDO)
  })

  test('lo mismo para una reserva y para una confirmación', () => {
    expect(revisarRespuesta(bloqueable, { reservo: true, cancelo: false, confirmo: false, ultima: 'reservo' }).texto)
      .toBe(RESPALDO_SEGUN_ACCION.reservo)
    expect(revisarRespuesta(bloqueable, { reservo: false, cancelo: false, confirmo: true, ultima: 'confirmo' }).texto)
      .toBe(RESPALDO_SEGUN_ACCION.confirmo)
  })

  test('si en el turno hubo dos acciones, manda la última', () => {
    // Reservar y cancelar a los pocos minutos: el cliente tiene que oír lo último que pasó.
    const revision = revisarRespuesta(bloqueable, { reservo: true, cancelo: true, confirmo: false, ultima: 'cancelo' })
    expect(revision.texto).toBe(RESPALDO_SEGUN_ACCION.cancelo)
  })

  test('sin evidencia de nada sigue diciendo que no pudo', () => {
    // Es lo honesto cuando de verdad no pasó nada: prometer lo contrario sería peor.
    const revision = revisarRespuesta(bloqueable, sinEvidencia)
    expect(revision.texto).toBe(RESPUESTA_DE_RESPALDO)
  })

  test('ningún respaldo inventa horas ni nombres', () => {
    // El respaldo se manda sin haber leído el texto del modelo: no puede afirmar detalles.
    for (const texto of Object.values(RESPALDO_SEGUN_ACCION)) {
      expect(texto).not.toMatch(/\d{1,2}:\d{2}/)
      expect(texto.length).toBeLessThan(120)
    }
  })
})

test.describe('Lo legítimo sigue saliendo', () => {
  const legitimas = [
    'Hola 👋 ¿En qué te ayudo?',
    'Tengo estas horas para el lunes: 09:00 con Valentina y 09:45 con Camila. ¿Cuál eliges?',
    'El Corte y Peinado dura 45 minutos y vale $15.000.',
    'Listo, cancelé tu hora del lunes 17 a las 09:00. ¿Quieres que te busque otra?',
    'Estamos en Av. Providencia 1234. ¿Te mando la ubicación?',
  ]

  test('ninguna respuesta normal se marca como razonamiento', () => {
    for (const texto of legitimas) {
      expect(pareceRazonamiento(texto), texto).toBe(false)
      expect(pareceOtroIdioma(texto), texto).toBe(false)
    }
  })

  test('y ninguna se bloquea cuando la base respalda lo que dice', () => {
    const conEvidencia = { reservo: true, cancelo: true, confirmo: true }
    for (const texto of legitimas) {
      expect(revisarRespuesta(texto, conEvidencia).bloqueada, texto).toBe(false)
    }
  })
})
