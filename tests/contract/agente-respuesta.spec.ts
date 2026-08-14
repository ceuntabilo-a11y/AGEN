import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  RESPUESTA_DE_RESPALDO,
  detectarAfirmaciones,
  reunirEvidencia,
  revisarRespuesta,
  sanitizarRespuesta,
} from '@/lib/agent-reply'
import { levantarSupabaseFalso, type SupabaseFalso } from '../support/supabase-fake'
import { nodo } from '../support/n8n'

/**
 * A5 — lo que sale del modelo se revisa ANTES de llegarle al cliente.
 *
 * El prompt no es una garantía: un modelo puede inventar que reservó, escupir el resultado
 * crudo de una tool, filtrar un id interno o devolver algo vacío. La revisión vive en la app
 * (`@/lib/agent-reply`), no en el prompt, y el envío pasa por ahí obligatoriamente.
 */

const SIN_EVIDENCIA = { reservo: false, cancelo: false, confirmo: false }
const CON_RESERVA = { reservo: true, cancelo: false, confirmo: false }

test.describe('Nada de lo interno llega al cliente', () => {
  test('un id interno se limpia del texto', () => {
    const { texto, motivos } = sanitizarRespuesta('Listo, te espero. (ref 4cb0d138-6180-4842-8a88-1f633b08de5c)')
    expect(texto).not.toContain('4cb0d138')
    expect(motivos).toContain('id_interno')
  })

  test('el resultado crudo de una tool no se envía', () => {
    const revision = revisarRespuesta('{"status":409,"body":{"error":"El apartado venció"}}', SIN_EVIDENCIA)
    expect(revision.bloqueada).toBe(true)
    expect(revision.texto).toBe(RESPUESTA_DE_RESPALDO)
  })

  test('un error técnico no se le explica al cliente', () => {
    for (const texto of [
      'Hubo un error: HTTP 500 al llamar /api/agent/book',
      'TypeError: Cannot read properties of undefined',
      'No pude reservar (error: 23P01 conflicto de horario)',
    ]) {
      expect(revisarRespuesta(texto, SIN_EVIDENCIA).bloqueada, texto).toBe(true)
    }
  })

  test('los nombres internos del sistema no se filtran', () => {
    for (const texto of ['Guardé el holdId para tu hora', 'Consulté supabase y no hay cupo', 'El webhook de n8n falló']) {
      expect(revisarRespuesta(texto, SIN_EVIDENCIA).bloqueada, texto).toBe(true)
    }
  })

  test('el markdown técnico se limpia', () => {
    const { texto } = sanitizarRespuesta('Listo ```json\n{"a":1}\n``` te espero')
    expect(texto).not.toContain('```')
  })
})

test.describe('Una respuesta vacía o corrupta nunca se envía', () => {
  test('vacía o solo espacios', () => {
    for (const texto of ['', '   ', '\n\n']) {
      const revision = revisarRespuesta(texto, SIN_EVIDENCIA)
      expect(revision.bloqueada).toBe(true)
      expect(revision.texto).toBe(RESPUESTA_DE_RESPALDO)
    }
  })

  test('un texto demasiado corto para ser una respuesta', () => {
    expect(revisarRespuesta('.', SIN_EVIDENCIA).bloqueada).toBe(true)
  })

  test('una respuesta larguísima se recorta en vez de mandarse entera', () => {
    const revision = revisarRespuesta(`Hola. ${'muy larga '.repeat(400)}`, SIN_EVIDENCIA)
    expect(revision.bloqueada).toBe(false)
    expect(revision.texto.length).toBeLessThanOrEqual(1200)
  })
})

test.describe('No se afirma una acción que no ocurrió', () => {
  const afirmaciones = {
    reserva: ['Listo, quedaste agendada para el lunes a las 10:00.', 'Ya te reservé la hora del martes.', 'Tu reserva quedó confirmada para mañana.'],
    cancelacion: ['Listo, cancelé tu hora del jueves.', 'Tu reserva quedó cancelada.'],
    confirmacion: ['Confirmé tu reserva del viernes.', 'Tu hora quedó confirmada, te esperamos.'],
  }

  test('detecta cada tipo de afirmación', () => {
    expect(detectarAfirmaciones(afirmaciones.reserva[0]).reservo).toBe(true)
    expect(detectarAfirmaciones(afirmaciones.cancelacion[0]).cancelo).toBe(true)
    expect(detectarAfirmaciones(afirmaciones.confirmacion[0]).confirmo).toBe(true)
  })

  test('sin evidencia real, la afirmación se bloquea', () => {
    for (const grupo of Object.values(afirmaciones)) {
      for (const texto of grupo) {
        const revision = revisarRespuesta(texto, SIN_EVIDENCIA)
        expect(revision.bloqueada, texto).toBe(true)
        expect(revision.texto).toBe(RESPUESTA_DE_RESPALDO)
      }
    }
  })

  test('con evidencia real, la misma frase sí se envía', () => {
    const revision = revisarRespuesta(afirmaciones.reserva[0], CON_RESERVA)
    expect(revision.bloqueada).toBe(false)
    expect(revision.texto).toBe(afirmaciones.reserva[0])
  })

  test('la evidencia de una acción no habilita otra', () => {
    expect(revisarRespuesta(afirmaciones.cancelacion[0], CON_RESERVA).bloqueada).toBe(true)
    expect(revisarRespuesta(afirmaciones.confirmacion[0], CON_RESERVA).bloqueada).toBe(true)
  })

  test('ofrecer, preguntar o proponer no es afirmar', () => {
    for (const texto of [
      '¿Te agendo el lunes a las 10:00?',
      'Tengo hora el lunes a las 10:00 y el martes a las 12:00. ¿Cuál prefieres?',
      'Si quieres te reservo la del martes, dime y la tomo.',
      '¿Confirmas tu hora del viernes?',
      'Para cancelar tu hora necesito que me confirmes cuál.',
    ]) {
      const revision = revisarRespuesta(texto, SIN_EVIDENCIA)
      expect(revision.bloqueada, texto).toBe(false)
      expect(revision.texto, texto).toBe(texto)
    }
  })

  test('una respuesta normal sin afirmaciones pasa intacta', () => {
    const texto = 'Hola. El Corte y Peinado dura 45 minutos y cuesta $18.000. ¿Qué día te acomoda?'
    expect(revisarRespuesta(texto, SIN_EVIDENCIA)).toEqual({ texto, bloqueada: false, motivos: [] })
  })
})

test.describe('La evidencia sale de la base, no de lo que diga el modelo', () => {
  let falso: SupabaseFalso
  let db: SupabaseClient
  const NEGOCIO = 'negocio-1'
  const CLIENTE = 'cliente-1'
  const DESDE = '2026-08-12T12:00:00.000Z'

  test.beforeEach(async () => {
    falso = await levantarSupabaseFalso({ appointments: [] })
    db = createClient(falso.url, 'clave', { auth: { persistSession: false, autoRefreshToken: false } })
  })

  test.afterEach(async () => { await falso.cerrar() })

  const cita = (extra: Record<string, unknown>) => ({
    id: 'cita-1', business_id: NEGOCIO, client_id: CLIENTE, status: 'PENDING',
    created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T10:00:00.000Z', client_confirmed_at: null, ...extra,
  })

  test('sin reservas nuevas no hay evidencia de nada', async () => {
    falso.tablas.appointments = [cita({})]
    expect(await reunirEvidencia(db, { businessId: NEGOCIO, clientId: CLIENTE, desde: DESDE })).toEqual(SIN_EVIDENCIA)
  })

  test('una reserva recién creada es evidencia de reserva', async () => {
    falso.tablas.appointments = [cita({ created_at: '2026-08-12T12:00:30.000Z' })]
    expect(await reunirEvidencia(db, { businessId: NEGOCIO, clientId: CLIENTE, desde: DESDE })).toEqual({ reservo: true, cancelo: false, confirmo: false })
  })

  test('una cancelación reciente es evidencia de cancelación', async () => {
    falso.tablas.appointments = [cita({ status: 'CANCELLED', updated_at: '2026-08-12T12:00:30.000Z' })]
    const evidencia = await reunirEvidencia(db, { businessId: NEGOCIO, clientId: CLIENTE, desde: DESDE })
    expect(evidencia.cancelo).toBe(true)
    expect(evidencia.reservo).toBe(false)
  })

  test('una confirmación del cliente es evidencia de confirmación', async () => {
    falso.tablas.appointments = [cita({ status: 'CONFIRMED', client_confirmed_at: '2026-08-12T12:00:30.000Z' })]
    expect((await reunirEvidencia(db, { businessId: NEGOCIO, clientId: CLIENTE, desde: DESDE })).confirmo).toBe(true)
  })

  test('las reservas de otro cliente no cuentan como evidencia', async () => {
    falso.tablas.appointments = [cita({ client_id: 'otro-cliente', created_at: '2026-08-12T12:00:30.000Z' })]
    expect(await reunirEvidencia(db, { businessId: NEGOCIO, clientId: CLIENTE, desde: DESDE })).toEqual(SIN_EVIDENCIA)
  })

  test('sin cliente registrado no puede haber evidencia', async () => {
    expect(await reunirEvidencia(db, { businessId: NEGOCIO, clientId: null, desde: DESDE })).toEqual(SIN_EVIDENCIA)
  })
})

test.describe('El workflow no puede saltarse la revisión', () => {
  test('el envío al cliente pasa por la app, no directo a Evolution', () => {
    const envio = nodo('Enviar a WhatsApp')
    const url = String((envio.parameters as { url?: string }).url ?? '')
    expect(url, 'el texto del modelo no puede ir directo al proveedor').toContain('/api/agent/reply')
    expect(url).not.toContain('EVOLUTION_API_URL')
  })

  test('un fallo de envío tiene que romper la ejecución, no pasar de largo', () => {
    const envio = nodo('Enviar a WhatsApp') as unknown as { onError?: string; parameters: Record<string, any> }
    expect(envio.onError ?? 'stopWorkflow').not.toBe('continueRegularOutput')
    expect(JSON.stringify(envio.parameters)).not.toContain('neverError')
  })

  test('el envío se reintenta con el MISMO texto, sin volver a correr el modelo', () => {
    const envio = nodo('Enviar a WhatsApp') as unknown as { retryOnFail?: boolean; maxTries?: number }
    expect(envio.retryOnFail).toBe(true)
    expect(envio.maxTries ?? 0).toBeGreaterThan(1)
  })

  test('el envío manda el messageId: es la fila donde se guarda la respuesta pendiente', () => {
    // Sin messageId no hay rescate posible: la respuesta no se puede asociar a ninguna fila.
    expect(String((nodo('Enviar a WhatsApp').parameters as { body?: string }).body))
      .toContain("messageId: $('Entrada').first().json.messageId")
  })

  test('se persiste el texto que se entregó, no el que quiso decir el modelo', () => {
    expect(String((nodo('Persistir interacción').parameters as { body?: string }).body))
      .toContain("$('Enviar a WhatsApp').first().json.text")
  })

  test('un fallo de la bandeja no deja seguir el pipeline', () => {
    // Registrar y Agrupar deciden quién contesta: si fallan y la ejecución continúa, el
    // cliente recibe dos respuestas o una respuesta al mensaje equivocado.
    for (const nombre of ['Registrar', 'Agrupar']) {
      const critico = nodo(nombre) as unknown as { onError?: string }
      expect(critico.onError ?? 'stopWorkflow', nombre).not.toBe('continueRegularOutput')
    }
  })

  test('lo cosmético sí puede fallar en silencio', () => {
    // Marcar leído y el "escribiendo…" no cambian ninguna decisión: que fallen no puede
    // impedir que el cliente reciba su respuesta.
    for (const nombre of ['Marcar leído', 'Escribiendo…']) {
      const cosmetico = nodo(nombre) as unknown as { onError?: string }
      expect(cosmetico.onError, nombre).toBe('continueRegularOutput')
    }
  })
})
