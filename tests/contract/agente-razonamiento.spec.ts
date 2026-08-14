import { test, expect } from '@playwright/test'
import { RESPUESTA_DE_RESPALDO, pareceOtroIdioma, pareceRazonamiento, revisarRespuesta } from '@/lib/agent-reply'

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
