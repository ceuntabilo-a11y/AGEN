import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { formatearParaWhatsApp } from '@/lib/whatsapp-format'
import { RESPUESTA_DE_RESPALDO } from '@/lib/agent-reply'
import { POST as POST_responder } from '@/app/api/agent/reply/route'
import { levantarSupabaseFalso, peticionAgente, usarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'

/**
 * Presentación, no contenido.
 *
 * Esta capa ordena visualmente lo que el agente ya decidió decir. La prueba que de verdad
 * importa es la última de cada caso: **la sustancia del mensaje —todas sus letras y números— no
 * cambia**. Si alguna vez cambiara, sería la capa reformulando al agente, y eso es exactamente
 * lo que no puede pasar.
 */

/** El texto sin nada de formato: sin espacios, viñetas, asteriscos ni separadores. */
const sustancia = (texto: string) => texto.replace(/[\s*•·▪◦—–|-]/g, '').toLowerCase()

/** Cada caso comprueba lo mismo: mejora visible y sustancia intacta. */
function ordenar(original: string) {
  const salida = formatearParaWhatsApp(original)
  expect(sustancia(salida), 'la capa de formato cambió lo que dice el mensaje').toBe(sustancia(original))
  return salida
}

test.describe('Disponibilidad: la lista de horarios se lee de un vistazo', () => {
  const original = [
    'Tenemos estos horarios el martes 17 de agosto en la tarde:',
    '• 13:00 con Camila Rojas — $15.000',
    '• 13:00 con Valentina Soto — $15.000',
    '• 13:45 con Camila Rojas — $15.000',
    '¿Cuál prefieres? 😊',
  ].join('\n')

  test('desaparecen las viñetas y cada opción queda en su bloque', () => {
    const salida = ordenar(original)
    expect(salida).not.toContain('•')
    expect(salida).toContain('*13:00 con Camila Rojas*\n$15.000')
    expect(salida).toContain('*13:45 con Camila Rojas*\n$15.000')
  })

  test('los bloques se separan con una línea en blanco', () => {
    expect(ordenar(original)).toContain('$15.000\n\n*13:00 con Valentina Soto*')
  })

  test('la pregunta final respira', () => {
    expect(ordenar(original)).toMatch(/\n\n¿Cuál prefieres\? 😊$/)
  })

  test('la negrita marca el dato principal y nada más', () => {
    const salida = ordenar(original)
    // Tres cabeceras en negrita: seis asteriscos. Ni el precio ni la frase de entrada.
    expect((salida.match(/\*/g) ?? []).length).toBe(6)
    expect(salida).toContain('Tenemos estos horarios el martes 17 de agosto en la tarde:')
  })
})

test.describe('Varios profesionales y varios horarios', () => {
  test('una lista numerada se ordena conservando su numeración', () => {
    // El número es un dígito, o sea contenido: la capa no lo borra, solo lo ordena.
    const salida = ordenar([
      'Para el jueves tengo:',
      '1. 10:00 con Isidora Castro — $12.000',
      '2. 11:30 con Camila Rojas — $12.000',
      '3. 16:00 con Valentina Soto — $12.000',
      '¿Te sirve alguno?',
    ].join('\n'))
    expect(salida).toContain('*1. 10:00 con Isidora Castro*\n$12.000')
    expect(salida).toContain('*3. 16:00 con Valentina Soto*\n$12.000')
    expect(salida).toMatch(/\n\n¿Te sirve alguno\?$/)
  })

  test('con guion como viñeta pasa lo mismo', () => {
    const salida = ordenar('Horarios libres:\n- 09:00 con Camila Rojas — $15.000\n- 09:45 con Camila Rojas — $15.000')
    expect(salida).not.toMatch(/^-\s/m)
    expect(salida).toContain('*09:00 con Camila Rojas*')
  })
})

/**
 * El fallo real de la ejecución 9236 del n8n de producción: una opción que encadena dos
 * servicios tiene DOS precios, y bajar el primero a su propia línea lo dejaba pegado al nombre
 * del segundo profesional. El cliente leía «$15.000 + Manicura — Fernanda Muñoz — $14.000» y el
 * precio del corte parecía el de la manicura.
 */
test.describe('Opciones que encadenan dos servicios', () => {
  const original = [
    'Mañana a las 15:00 no tenemos disponibilidad. Puedo agendarlos el lunes 17 de agosto a las 09:00 en estas combinaciones:',
    '1) Corte y Peinado — Valentina Soto — $15.000 + Manicura Semipermanente — Fernanda Muñoz — $14.000.',
    '2) Corte y Peinado — Camila Rojas — $15.000 + Manicura Semipermanente — Javiera Contreras — $14.000.',
    '¿Cuál prefieres? 📝',
  ].join('\n')

  test('cada precio queda en la línea de SU servicio', () => {
    const salida = ordenar(original)
    expect(salida).toContain('1) Corte y Peinado — Valentina Soto — $15.000')
    expect(salida).toContain('+ Manicura Semipermanente — Fernanda Muñoz — $14.000.')
  })

  test('nunca se separa un precio de su servicio dejándolo junto a otro nombre', () => {
    const salida = ordenar(original)
    // Esto era exactamente lo que salía antes y no puede volver a salir.
    expect(salida).not.toContain('*1) Corte y Peinado — Valentina Soto*\n$15.000 +')
    for (const linea of salida.split('\n')) {
      expect((linea.match(/\$/g) ?? []).length, `dos precios en una misma línea: ${linea}`).toBeLessThan(2)
    }
  })

  test('el segundo servicio empieza en su propia línea, no pegado al primero', () => {
    expect(ordenar(original)).toMatch(/\$15\.000\n\+ Manicura/)
  })

  test('la pregunta final sigue respirando', () => {
    expect(ordenar(original)).toMatch(/\n\n¿Cuál prefieres\? 📝$/)
  })
})

test.describe('Duración y precio', () => {
  test('la duración también baja a su propia línea', () => {
    const salida = ordenar([
      'Estos son los tratamientos faciales:',
      '• Limpieza Facial Profunda — 60 minutos',
      '• Tratamiento Antiedad — 75 minutos',
    ].join('\n'))
    expect(salida).toContain('*Limpieza Facial Profunda*\n60 minutos')
    expect(salida).toContain('*Tratamiento Antiedad*\n75 minutos')
  })

  test('una sola frase que ya se lee bien se deja EXACTAMENTE igual', () => {
    const original = 'El Tratamiento Antiedad dura 75 minutos y cuesta $32.000.'
    expect(formatearParaWhatsApp(original)).toBe(original)
  })
})

test.describe('Propuesta, confirmación, cancelación y reprogramación', () => {
  test('la propuesta separa la pregunta del dato', () => {
    const salida = ordenar('Perfecto. Te propongo Corte y Peinado el martes 17 de agosto a las 13:00 con Camila Rojas — $15.000. ¿Confirmas? 😊')
    expect(salida).toMatch(/\n\n¿Confirmas\? 😊$/)
    expect(salida.startsWith('Perfecto. Te propongo Corte y Peinado')).toBe(true)
  })

  test('una confirmación corta no se toca', () => {
    const original = 'Listo, tu hora quedó confirmada. Te esperamos.'
    expect(formatearParaWhatsApp(original)).toBe(original)
  })

  test('una cancelación con oferta deja la pregunta aparte y no inventa nada', () => {
    const original = 'Listo, cancelé tu hora del lunes 17 a las 09:30 con Isidora Castro. ¿Quieres que te busque otro horario?'
    const salida = ordenar(original)
    expect(salida).toMatch(/\n\n¿Quieres que te busque otro horario\?$/)
    expect(salida).toContain('cancelé tu hora del lunes 17 a las 09:30 con Isidora Castro.')
  })

  test('una reprogramación con alternativas queda en bloques', () => {
    const salida = ordenar([
      'Liberé tu hora del martes. Te dejo otras opciones para el miércoles:',
      '• 10:00 con Camila Rojas — $15.000',
      '• 15:30 con Valentina Soto — $15.000',
      '¿Cuál te acomoda?',
    ].join('\n'))
    expect(salida).toContain('Liberé tu hora del martes.')
    expect(salida).toContain('*10:00 con Camila Rojas*\n$15.000')
    expect(salida).toMatch(/\n\n¿Cuál te acomoda\?$/)
  })
})

test.describe('Respuestas cortas y casos límite', () => {
  test('una respuesta de una línea sigue siendo de una línea', () => {
    for (const original of ['Claro, dime.', 'Perfecto 😊', 'Sí, atendemos los sábados.']) {
      expect(formatearParaWhatsApp(original)).toBe(original)
    }
  })

  test('un texto vacío o en blanco no se rompe', () => {
    expect(formatearParaWhatsApp('')).toBe('')
    expect(formatearParaWhatsApp('   ')).toBe('   ')
  })

  test('no se añade ni un emoji ni una palabra que no estuviera', () => {
    const original = 'Tengo estas opciones para hoy:\n• 17:00 con Camila Rojas — $15.000\n• 18:00 con Camila Rojas — $15.000\n¿Cuál prefieres?'
    const salida = ordenar(original)
    // La firma incluye los emojis y la puntuación: si se hubiera añadido o quitado uno, falla.
    expect(salida).not.toMatch(/\|/)
    expect(salida.split('😊').length).toBe(original.split('😊').length)
  })

  test('lo que ya venía en negrita no se envuelve dos veces', () => {
    const salida = ordenar('Opciones:\n• *10:00 con Camila Rojas* — $15.000\n• *11:00 con Camila Rojas* — $15.000')
    expect(salida).not.toContain('**')
  })

  test('un texto larguísimo se deja como estaba en vez de crecer más', () => {
    const original = `Opciones:\n${Array.from({ length: 80 }, (_, i) => `• 1${i % 10}:00 con Camila Rojas — $15.000`).join('\n')}`
    expect(formatearParaWhatsApp(original)).toBe(original)
  })
})

test.describe('La garantía: presentación nunca es contenido', () => {
  const CASOS = [
    'Tenemos estos horarios el martes 17:\n• 13:00 con Camila Rojas — $15.000\n• 13:45 con Valentina Soto — $15.000\n¿Cuál prefieres? 😊',
    'Perfecto. Te propongo Corte y Peinado el martes 17 a las 13:00 con Camila Rojas — $15.000. ¿Confirmas?',
    'El Tratamiento Antiedad dura 75 minutos y cuesta $32.000.',
    'Listo, tu hora quedó reservada. Si necesitas cambiarla, dime.',
    'Listo, cancelé tu hora. ¿Quieres que te busque otro horario?',
    'Liberé tu hora del martes 17 y te dejo el miércoles 18 a las 10:00 con Camila Rojas — $15.000. ¿Te sirve?',
    'Claro, dime.',
    'Disculpa, tuve un problema y no pude completar eso. ¿Quieres que lo intente de nuevo?',
  ]

  CASOS.forEach((original, indice) => {
    test(`caso ${indice + 1}: misma sustancia antes y después`, () => {
      expect(sustancia(formatearParaWhatsApp(original))).toBe(sustancia(original))
    })
  })

  test('formatear dos veces da lo mismo que formatear una', () => {
    // Si no fuera estable, un reintento de envío mandaría un texto distinto del que se guardó.
    for (const original of CASOS) {
      const una = formatearParaWhatsApp(original)
      expect(formatearParaWhatsApp(una)).toBe(una)
    }
  })
})

/**
 * La conexión real: lo que sale por WhatsApp es el texto ya ordenado, y lo que se guarda para un
 * reintento es exactamente ese mismo texto (si no, el reintento mandaría otra cosa).
 */
test.describe('La ruta de salida envía el texto ya ordenado', () => {
  const NEGOCIO = 'negocio-1'
  const TELEFONO = '56911112222'
  let falso: SupabaseFalso
  let evolution: Server
  let enviados: string[]

  const LISTA = 'Tengo estos horarios:\n• 13:00 con Camila Rojas — $15.000\n• 13:45 con Camila Rojas — $15.000\n¿Cuál prefieres?'

  const responder = (reply: string, messageId?: string) => POST_responder(peticionAgente(
    'http://localhost/api/agent/reply',
    { businessId: NEGOCIO, phone: TELEFONO, reply, messageId },
  ))

  test.beforeEach(async () => {
    enviados = []
    evolution = createServer((peticion, respuesta) => {
      const trozos: Buffer[] = []
      peticion.on('data', (trozo: Buffer) => trozos.push(trozo))
      peticion.on('end', () => {
        enviados.push(String(JSON.parse(Buffer.concat(trozos).toString('utf8')).text ?? ''))
        respuesta.writeHead(200, { 'content-type': 'application/json' })
        respuesta.end('{"ok":true}')
      })
    })
    await new Promise<void>((listo) => evolution.listen(0, '127.0.0.1', listo))
    process.env.EVOLUTION_API_URL = `http://127.0.0.1:${(evolution.address() as AddressInfo).port}`
    process.env.EVOLUTION_API_KEY = 'clave-de-prueba'

    falso = await levantarSupabaseFalso({
      businesses: [{
        id: NEGOCIO, active: true, whatsapp_provider: 'EVOLUTION', whatsapp_instance: 'bella',
        whatsapp_phone_id: null, whatsapp_token: null, whatsapp_360_api_key: null,
      }],
      clients: [{ id: 'cli-1', business_id: NEGOCIO, phone: TELEFONO }],
      appointments: [],
      agent_inbox: [{ id: 1, business_id: NEGOCIO, phone: TELEFONO, message_id: 'wa-1', content: 'hola', reply_text: null, reply_attempts: 0 }],
    })
    usarSupabaseFalso(falso)
  })

  test.afterEach(async () => {
    await falso.cerrar()
    // Sin cerrar las conexiones vivas, `close()` se queda esperando a un keep-alive del cliente.
    evolution.closeAllConnections?.()
    await new Promise<void>((listo) => evolution.close(() => listo()))
  })

  test('el WhatsApp sale ordenado, no amontonado', async () => {
    const cuerpo = await (await responder(LISTA)).json()
    expect(cuerpo.sent).toBe(true)
    expect(enviados[0]).toContain('*13:00 con Camila Rojas*\n$15.000')
    expect(enviados[0]).not.toContain('•')
    expect(sustancia(enviados[0])).toBe(sustancia(LISTA))
  })

  test('lo que se guarda para reintentar es el mismo texto que salió', async () => {
    await responder(LISTA, 'wa-1')
    const guardada = falso.tablas.agent_inbox[0]
    expect(guardada.reply_text).toBe(enviados[0])
  })

  test('una respuesta bloqueada sale tal cual: el respaldo ya es una línea limpia', async () => {
    const cuerpo = await (await responder('{"status":409,"error":"vencido"}')).json()
    expect(cuerpo.blocked).toBe(true)
    expect(enviados[0]).toBe(RESPUESTA_DE_RESPALDO)
  })
})
