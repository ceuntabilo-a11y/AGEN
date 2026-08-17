import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'
import { cargarContexto } from '@/lib/agent-context'
import { respuestaRapida } from '@/lib/agent-fast-path'
import { chatCompletion, resolveOpenAiKey } from '@/lib/openai'
import { datosSueltosDelMensaje, esCumpleanosHoy } from '@/lib/agent-datos'
import { comentarioDelMensaje, guardarNotaDeEncuesta, notaDelMensaje, textoDeAgradecimiento } from '@/lib/agent-encuesta'
import { guardarClienteDelAgente } from '@/lib/agent-booking'
import { describirMedia, fotosDelPortafolio } from '@/lib/agent-media'
import { registrarAviso } from '@/lib/observabilidad'
import { formatInZone, formatTimeInZone } from '@/lib/timezone'
import {
  aplicarGuardas, armarContexto, clasificarPorReglas, instruccionesDe, lineaDeCumpleanos,
  preguntaPorElDato, rutaDe, siguienteDatoQueFalta,
  type ApartadoVivo, type EstadoDelTurno, type Intencion, type Ruta,
} from '@/lib/agent-router'

export const dynamic = 'force-dynamic'

/**
 * El turno completo del agente, decidido en la app.
 *
 * Reemplaza a `/api/agent/context` como puerta del workflow. Además del contexto de siempre,
 * devuelve **por qué rama va este turno** y **qué instrucciones exactas** lleva el modelo en
 * esa rama. Con eso, n8n deja de tener nueve herramientas colgando de un único agente que
 * decidía solo: cada rama tiene sus herramientas y ninguna puede ejecutar una acción — quien
 * reserva, cancela, mueve o confirma es `/api/agent/act`.
 *
 * La decisión se toma en dos capas (ver `@/lib/agent-router`): reglas + estado real de la base
 * de datos. El clasificador del modelo solo desempata, y si no hay clave o falla, se usa la
 * regla: el turno nunca se queda sin rama.
 */

/** Intenciones válidas del clasificador. Cualquier otra cosa se descarta. */
const INTENCIONES = ['SALUDO', 'INFO', 'AGENDAR', 'ELEGIR', 'CANCELAR', 'MOVER', 'CONFIRMAR', 'ESCALAR', 'FUERA_DE_ALCANCE']

const PROMPT_CLASIFICADOR = [
  'Clasifica el ÚLTIMO mensaje de un cliente de un negocio de servicios (peluquería, estética).',
  'Responde SOLO con una de estas palabras, sin explicar nada:',
  'SALUDO INFO AGENDAR ELEGIR CANCELAR MOVER CONFIRMAR ESCALAR FUERA_DE_ALCANCE',
  '',
  'SALUDO: saluda, agradece o se despide y nada más.',
  'INFO: pregunta por precios, servicios, dirección, horarios o quién atiende.',
  'AGENDAR: quiere una hora o pregunta si hay disponibilidad.',
  'ELEGIR: está eligiendo o aceptando uno de los horarios que ya se le ofrecieron.',
  'CANCELAR: no puede venir o pide anular su hora.',
  'MOVER: quiere la misma hora en otro momento.',
  'CONFIRMAR: avisa que sí va a asistir.',
  'ESCALAR: pide hablar con una persona, reclama, o habla de pagos y comprobantes.',
  'FUERA_DE_ALCANCE: no tiene nada que ver con el negocio.',
].join('\n')

/** Apartados vivos de este contacto: son la prueba de que se le ofrecieron horarios. */
async function apartadosVivos(
  db: ReturnType<typeof createAdminClient>,
  datos: { businessId: string; clientId: string | null; phone: string; timezone: string },
): Promise<ApartadoVivo[]> {
  /*
   * Se busca por las dos claves y por las dos formas del teléfono.
   *
   * `claveDeContacto` deja una sola forma al guardar, pero un apartado creado por una versión
   * anterior puede tener el `+` delante: si no se mirara, el cliente elegiría un horario que se
   * le ofreció hace un minuto y el sistema no encontraría nada que reservar.
   */
  const claves = [
    ...(datos.clientId ? [`client_id.eq.${datos.clientId}`] : []),
    `contact_key.eq.${datos.phone}`,
    `contact_key.eq.+${datos.phone}`,
  ]
  const { data } = await db.from('appointment_holds')
    .select('id,service_id,professional_id,period,expires_at,service:services(name),professional:professionals(display_name)')
    .eq('business_id', datos.businessId)
    .or(claves.join(','))
    .gt('expires_at', new Date().toISOString())
    .limit(5)

  return ((data ?? []) as Array<Record<string, any>>).map((fila) => {
    const inicio = String(fila.period ?? '').replace(/[[\]()"]/g, '').split(',')[0]
    const servicio = Array.isArray(fila.service) ? fila.service[0] : fila.service
    const profesional = Array.isArray(fila.professional) ? fila.professional[0] : fila.professional
    return {
      holdId: String(fila.id),
      serviceId: String(fila.service_id),
      serviceName: servicio?.name ?? null,
      professionalId: String(fila.professional_id),
      professionalName: profesional?.display_name ?? null,
      start: inicio,
      dia: inicio ? formatInZone(inicio, datos.timezone, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
      hora: inicio ? formatTimeInZone(inicio, datos.timezone) : '',
    }
  }).filter((item) => item.start)
}

/** El contexto del turno, con los mismos nombres de campo de siempre (ver `armarContexto`). */
function armarUserMessage(
  mensaje: string,
  businessId: string,
  contexto: Record<string, any>,
  estado: EstadoDelTurno,
): string {
  const cliente = contexto.client ?? null
  const memoria = Array.isArray(cliente?.client_memory) ? cliente.client_memory[0] : cliente?.client_memory
  return armarContexto({
    mensaje,
    businessId,
    business: contexto.business ?? null,
    branches: contexto.branches ?? [],
    services: contexto.services ?? [],
    cliente,
    memoria: memoria ? {
      resumen: memoria.conversation_summary ?? null,
      hechos: memoria.known_facts ?? null,
      preferencias: memoria.preferences ?? null,
      profesionalPreferido: memoria.preferred_professional_id ?? null,
      servicioPreferido: memoria.preferred_service_id ?? null,
    } : null,
    recent: contexto.recent ?? [],
    time: contexto.time ?? null,
    equipo: { teamMember: contexto.teamMember ?? null, today: contexto.today ?? [], waiting: contexto.waiting, followups: contexto.followups },
    formatearHora: (valor) => formatTimeInZone(valor, estado.timezone),
  }, estado)
}

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await request.json() as {
    businessId?: string; phone?: string; message?: string
    mediaType?: 'image' | 'audio' | null; mediaUrl?: string | null
  }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone) return NextResponse.json({ error: 'businessId y phone son obligatorios' }, { status: 400 })

  const db = createAdminClient()

  /*
   * Multimedia (requisito F). Una nota de voz se transcribe y una imagen se describe ANTES de
   * clasificar, para que el turno se enrute por lo que la persona dijo o mandó y no por un
   * mensaje vacío. Si la capacidad está apagada o falla, `describirMedia` devuelve null y todo
   * sigue exactamente como antes: el agente trabaja con el texto.
   */
  const media = await describirMedia(db, { businessId: body.businessId, mediaType: body.mediaType ?? null, mediaUrl: body.mediaUrl ?? null })
  const mensaje = [String(body.message ?? '').trim(), media.texto ? `[${media.tipo === 'audio' ? 'nota de voz' : 'imagen'}: ${media.texto}]` : '']
    .filter(Boolean).join(' ').trim()

  const contexto = await cargarContexto(db, { businessId: body.businessId, phone, message: mensaje.slice(0, 500) })
  if ('error' in contexto) {
    if (contexto.error === 'inexistente') return NextResponse.json({ error: 'Negocio inexistente o inactivo' }, { status: 404 })
    return NextResponse.json({ error: 'No se pudo cargar el contexto del negocio' }, { status: 500 })
  }

  const datos = contexto as Record<string, any>
  const timezone: string = datos.timezone ?? 'America/Santiago'
  const cliente = datos.client ?? null

  /*
   * Datos que se reconocen sin modelo (requisito 13). Un correo y una fecha tienen forma: se
   * guardan en cuanto aparecen, sin gastar un turno ni arriesgar que el modelo los invente.
   */
  const sueltos = datosSueltosDelMensaje(mensaje)
  let correoGuardado: string | null = cliente?.email ?? null
  let nacimientoGuardado: string | null = cliente?.birthday ?? null
  if (cliente?.id && (sueltos.correo || sueltos.nacimiento)) {
    const guardado = await guardarClienteDelAgente(db, {
      businessId: body.businessId, phone,
      email: sueltos.correo ?? undefined,
      birthday: sueltos.nacimiento ?? undefined,
    })
    if (guardado.ok) {
      correoGuardado = (guardado.client.email as string | null) ?? correoGuardado
      nacimientoGuardado = (guardado.client.birthday as string | null) ?? nacimientoGuardado
    }
  }

  const apartados = await apartadosVivos(db, { businessId: body.businessId, clientId: cliente?.id ?? null, phone, timezone })

  const estado: EstadoDelTurno = {
    actorType: datos.actorType === 'TEAM' ? 'TEAM' : 'CLIENT',
    clienteRegistrado: Boolean(cliente?.id),
    nombreCliente: cliente?.full_name ?? null,
    correoCliente: correoGuardado,
    nacimientoCliente: nacimientoGuardado,
    reservas: datos.appointments ?? [],
    apartados,
    avisoPendiente: datos.pendingNotice ?? null,
    timezone,
  }

  const cumple = esCumpleanosHoy(estado.nacimientoCliente, timezone)

  /*
   * Respuesta a una encuesta: es un número, así que la guarda el código.
   *
   * Sin esto, el «9» del cliente llegaba al modelo, que como mucho daba las gracias, y la nota
   * se perdía: `survey_responses` tenía una columna `source = 'AI_AGENT'` preparada desde el
   * primer día y nadie escribía nunca en ella. Va antes de clasificar porque no hay nada que
   * clasificar — la pregunta ya la hizo el negocio y la respuesta es un número.
   */
  if (estado.avisoPendiente?.expects === 'RATING' && cliente?.id) {
    const nota = notaDelMensaje(mensaje)
    if (nota !== null) {
      const guardada = await guardarNotaDeEncuesta(db, {
        businessId: body.businessId,
        clientId: cliente.id,
        appointmentId: estado.avisoPendiente.appointmentId ?? null,
        nota,
        comentario: comentarioDelMensaje(mensaje),
      })
      registrarAviso('encuesta_respondida', { businessId: body.businessId, nota, guardada: guardada.guardada })
      return NextResponse.json({
        ruta: 'DIRECTA' as Ruta, intencion: 'ENCUESTA', texto: textoDeAgradecimiento(nota),
        systemMessage: '', userMessage: '', imageUrl: null,
        wasAudio: media.tipo === 'audio', businessId: body.businessId, phone, timezone,
      })
    }
  }

  // Camino rápido: un saludo, un agradecimiento o una despedida no necesitan modelo.
  const rapida = respuestaRapida(mensaje, {
    actorType: estado.actorType,
    pendingNotice: estado.avisoPendiente,
    businessName: datos.business?.name ?? null,
  })
  if (rapida && !apartados.length) {
    const felicitacion = cumple ? `¡Feliz cumpleaños${estado.nombreCliente ? `, ${estado.nombreCliente.split(' ')[0]}` : ''}! 🎉\n\n` : ''
    return NextResponse.json({
      ruta: 'DIRECTA' as Ruta, intencion: 'SALUDO', texto: felicitacion + rapida.texto,
      systemMessage: '', userMessage: '', imageUrl: null,
      wasAudio: media.tipo === 'audio', businessId: body.businessId, phone, timezone,
    })
  }

  // Capa 1: reglas. Capa 2 (clasificador) solo si las reglas dudan y hay clave disponible.
  const porReglas = clasificarPorReglas(mensaje, estado)
  let intencion: Intencion = porReglas.intencion
  let clasificador: 'reglas' | 'modelo' | 'reglas_por_fallo' = 'reglas'

  if (porReglas.confianza === 'BAJA' && estado.actorType === 'CLIENT') {
    try {
      const { key } = await resolveOpenAiKey(datos.business?.openai_api_key ?? null)
      if (key) {
        const respuesta = await chatCompletion(key, [
          { role: 'system', content: PROMPT_CLASIFICADOR },
          { role: 'user', content: mensaje.slice(0, 600) },
        ], { model: 'gpt-4o-mini', maxTokens: 6, temperature: 0 })
        const limpia = respuesta.toUpperCase().replace(/[^A-Z_]/g, '')
        if (INTENCIONES.includes(limpia)) { intencion = limpia as Intencion; clasificador = 'modelo' }
      }
    } catch (error) {
      // El clasificador es una ayuda, no una dependencia: si falla, manda la regla.
      registrarAviso('agente_clasificador_fallo', { businessId: body.businessId, error: String(error) })
      clasificador = 'reglas_por_fallo'
    }
  }

  const guarda = aplicarGuardas(intencion, estado)
  intencion = guarda.intencion
  if (guarda.corregidaPor) registrarAviso('agente_intencion_corregida', { businessId: body.businessId, motivo: guarda.corregidaPor, clasificador })

  if (guarda.textoDirecto) {
    return NextResponse.json({
      ruta: 'DIRECTA' as Ruta, intencion, texto: guarda.textoDirecto,
      systemMessage: '', userMessage: '', imageUrl: null,
      wasAudio: media.tipo === 'audio', businessId: body.businessId, phone, timezone,
    })
  }

  const ruta = rutaDe(intencion)

  /*
   * Fotos reales del portafolio (requisito F). Si el cliente manda una imagen de un trabajo y
   * el negocio tiene trabajos publicados con consentimiento, se le responde con una foto real.
   * La elige la base de datos, no el modelo: es imposible que muestre un trabajo inventado.
   */
  const imageUrl = media.tipo === 'imagen' && !media.pareceComprobante
    ? (await fotosDelPortafolio(db, { businessId: body.businessId, texto: media.texto ?? '' }))[0] ?? null
    : null

  const extras: string[] = []
  const linea = lineaDeCumpleanos(estado.nacimientoCliente, timezone)
  if (linea) extras.push(linea)
  if (imageUrl) extras.push('Se le va a adjuntar una foto real de un trabajo del portafolio: preséntala en una línea, sin describir lo que no ves.')
  if (media.pareceComprobante) extras.push('El cliente mandó lo que parece un comprobante de pago: no confirmes ningún pago, dile que lo revisará el equipo.')

  const faltante = estado.actorType === 'CLIENT' ? siguienteDatoQueFalta(estado) : null
  if (ruta !== 'DECIDIR' && faltante && intencion !== 'FUERA_DE_ALCANCE') {
    const pregunta = preguntaPorElDato(faltante)
    if (pregunta) extras.push(`Al final, y solo si encaja, pídele UN dato y solo uno: "${pregunta}"`)
  }

  return NextResponse.json({
    ruta,
    intencion,
    texto: null,
    systemMessage: instruccionesDe(ruta, extras),
    userMessage: armarUserMessage(mensaje, body.businessId, datos, estado),
    imageUrl,
    wasAudio: media.tipo === 'audio',
    businessId: body.businessId,
    phone,
    timezone,
    // Eco para la trazabilidad; `/api/agent/act` nunca confía en esto: relee la base.
    diagnostico: { clasificador, apartados: apartados.length, reservas: estado.reservas.length },
  })
}
