import { test, expect } from '@playwright/test'
import { respuestaRapida } from '@/lib/agent-fast-path'

/**
 * El camino rápido contesta sin modelo. Por eso lo que se prueba acá no es que acierte mucho,
 * sino que **no se equivoque nunca**: cada turno que no sea exactamente un saludo, un
 * agradecimiento o una despedida tiene que devolver `null` y seguir por el agente de siempre.
 */

const CLIENTE = { actorType: 'CLIENT', pendingNotice: null, businessName: 'Bella Vida' }

test.describe('Lo que sí contesta solo', () => {
  test('un saludo se contesta con el nombre del negocio, en una línea', () => {
    const salida = respuestaRapida('Hola', CLIENTE)
    expect(salida?.motivo).toBe('SALUDO')
    expect(salida?.texto).toBe('¡Hola! Soy la asistente de Bella Vida. ¿En qué te puedo ayudar?')
    expect(salida?.texto.split('\n')).toHaveLength(1)
  })

  test('da igual el adorno: mayúsculas, acentos, signos, emojis y letras repetidas', () => {
    for (const mensaje of ['hola', 'Hola!', 'HOLA', 'holaaaa', '¡Hola! 😊', 'Buenos días', 'buenos dias', 'Buenas tardes 🌞', 'buenas', 'Qué tal']) {
      expect(respuestaRapida(mensaje, CLIENTE)?.motivo, mensaje).toBe('SALUDO')
    }
  })

  test('un agradecimiento y una despedida también', () => {
    for (const mensaje of ['gracias', 'Muchas gracias!', 'Mil gracias 🙏', 'graciasss']) {
      expect(respuestaRapida(mensaje, CLIENTE)?.motivo, mensaje).toBe('AGRADECIMIENTO')
    }
    for (const mensaje of ['chao', 'Chao!', 'adiós', 'Nos vemos', 'hasta luego']) {
      expect(respuestaRapida(mensaje, CLIENTE)?.motivo, mensaje).toBe('DESPEDIDA')
    }
  })

  test('sin nombre de negocio sigue saludando, sin inventarse uno', () => {
    const salida = respuestaRapida('hola', { ...CLIENTE, businessName: null })
    expect(salida?.texto).toBe('¡Hola! ¿En qué te puedo ayudar?')
  })
})

test.describe('Lo que NO toca: ante la duda, que conteste el agente', () => {
  test('un saludo con una petición pegada va al agente', () => {
    for (const mensaje of [
      'Hola, quiero una hora',
      'hola necesito cancelar',
      'Buenas, ¿cuánto cuesta el corte?',
      'hola, ¿atienden el sábado?',
      'gracias, ¿y el precio?',
    ]) {
      expect(respuestaRapida(mensaje, CLIENTE), mensaje).toBeNull()
    }
  })

  test('las respuestas sueltas que aceptan lo último propuesto NUNCA se atajan', () => {
    // Regla 16 del prompt: "ok", "sí", "dale" continúan la conversación; una plantilla la rompería.
    for (const mensaje of ['ok', 'Ok', 'okey', 'sí', 'si', 'dale', 'bueno', 'ya', 'no', 'no puedo', 'ok gracias']) {
      expect(respuestaRapida(mensaje, CLIENTE), mensaje).toBeNull()
    }
  })

  test('con un aviso pendiente vivo manda el agente, siempre', () => {
    const conAviso = { ...CLIENTE, pendingNotice: { question: '¿Confirmas tu hora?', appointmentId: 'a-1' } }
    for (const mensaje of ['hola', 'gracias', 'chao']) {
      expect(respuestaRapida(mensaje, conAviso), mensaje).toBeNull()
    }
  })

  test('el equipo nunca pasa por el camino rápido', () => {
    expect(respuestaRapida('hola', { ...CLIENTE, actorType: 'TEAM' })).toBeNull()
    expect(respuestaRapida('hola', { ...CLIENTE, actorType: undefined })).toBeNull()
  })

  test('vacíos, ruido y mensajes largos', () => {
    for (const mensaje of ['', '   ', '😊', '?', 'aaa', 'Hola me llamo Fernanda y quería saber si tienen hora mañana']) {
      expect(respuestaRapida(mensaje, CLIENTE), JSON.stringify(mensaje)).toBeNull()
    }
    expect(respuestaRapida(null, CLIENTE)).toBeNull()
    expect(respuestaRapida(undefined, CLIENTE)).toBeNull()
  })
})
