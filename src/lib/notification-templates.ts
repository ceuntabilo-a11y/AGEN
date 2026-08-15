import { dateKeyInZone, formatInZone, formatTimeInZone } from '@/lib/timezone'

/**
 * Textos de los avisos que recibe el cliente por WhatsApp o correo.
 *
 * Un solo lugar arma todos los mensajes para que se vean iguales, ordenados y con la
 * información completa: qué pasó, cuándo es la cita, con quién, dónde, y qué puede hacer.
 * Formato de WhatsApp: *negrita*, _cursiva_. Se evitan bloques largos y links sueltos.
 */

export type NotificationEventType =
  | 'BOOKED'
  | 'CHANGED'
  | 'CONFIRM_REQUEST'
  | 'DAY_OF_REMINDER'
  | 'REMINDER_24H'
  | 'REMINDER_2H'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'WAITLIST_SLOT'
  | 'FOLLOW_UP'
  | 'REVIEW_REQUEST'

export type NotificationBusiness = {
  name: string
  address?: string | null
  maps_url?: string | null
  timezone: string
}

export type NotificationAppointment = {
  start: string
  end?: string | null
  serviceName?: string | null
  professionalName?: string | null
}

export type NotificationContext = {
  business: NotificationBusiness
  clientName?: string | null
  appointment?: NotificationAppointment | null
  payload?: Record<string, unknown>
}

/**
 * Qué respuesta espera el mensaje. Es lo que le permite al agente leer un «sí», un «no» o un
 * «después» sueltos: sin esto, la respuesta llega sin la pregunta.
 */
export type EsperaDeRespuesta = 'YES_NO' | 'CHOICE' | 'RATING' | 'FREE' | 'NONE'

export type EsperaDelAviso = {
  expects: EsperaDeRespuesta
  /** La pregunta en una línea, tal como la entendería una persona. */
  question: string
  /** Cuántas horas tiene sentido leer una respuesta como respuesta a ESTE mensaje. */
  ttlHours: number
  /**
   * Qué hacer si el cliente dice que sí, y qué si dice que no.
   *
   * Vive acá, junto al texto que se le mandó, y no en el prompt del agente. Dos razones: el
   * prompt se paga entero en cada turno de cada conversación, y una regla escrita en código se
   * puede probar. Además queda guardado con el aviso, así que si mañana cambia una plantilla,
   * el aviso ya enviado sigue significando lo que significaba cuando salió.
   */
  ifYes?: string
  ifNo?: string
}

export type BuiltNotification = { text: string; subject: string; espera: EsperaDelAviso }

const SEPARATOR = '━━━━━━━━━━━━━━━'

/**
 * Qué significa un «sí» y qué un «no» para cada tipo de aviso.
 *
 * Están agrupados porque varios avisos hacen la misma pregunta con otras palabras, y separados
 * donde de verdad se diferencian: un «sí» a una cancelación pide horarios nuevos, mientras que
 * un «sí» a un cambio de hora confirma la hora nueva. Tratarlos igual era exactamente el error.
 */
const CONFIRMAR_O_LIBERAR = {
  ifYes: 'Va a venir: llama confirmar_reserva con el appointmentId de este aviso.',
  ifNo: 'No puede venir: llama liberar_reserva con el appointmentId de este aviso y reason en sus palabras, y enseguida ofrécele horarios nuevos con buscar_horarios.',
}
const LE_ACOMODA_O_NO = {
  ifYes: 'Le acomoda como quedó: llama confirmar_reserva con el appointmentId de este aviso.',
  ifNo: 'No le acomoda: no confirmes nada, busca horarios con buscar_horarios y ofrécele alternativas.',
}
const YA_ESTA_CANCELADA = {
  ifYes: 'Quiere otro horario: ofrécele horarios con buscar_horarios. Esa hora ya está cancelada, así que no llames liberar_reserva ni confirmar_reserva.',
  ifNo: 'Por ahora no quiere otro horario: contesta una línea amable y no insistas.',
}
const OFRECER_HORARIOS = {
  ifYes: 'Quiere volver: ofrécele horarios con buscar_horarios.',
  ifNo: 'Ahora no: una línea amable, deja la puerta abierta y no insistas.',
}
const CUPO_LIBERADO = {
  ifYes: 'Quiere el cupo: búscalo con buscar_horarios ese día y resérvalo con crear_reserva; nunca digas que quedó tomado sin booked=true.',
  ifNo: 'No lo quiere: una línea amable y todo sigue como estaba.',
}

function firstName(value?: string | null) {
  const name = (value ?? '').trim()
  if (!name) return ''
  return name.split(/\s+/)[0]
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

/** "hoy", "mañana" o "jueves 7 de agosto", siempre en la zona horaria del negocio. */
export function longDate(value: string | Date, timeZone: string) {
  const todayKey = dateKeyInZone(new Date(), timeZone)
  const key = dateKeyInZone(value, timeZone)
  // es-CL escribe "domingo, 9 de agosto"; la coma sobra en un mensaje corto.
  const written = capitalize(formatInZone(value, timeZone, { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', ''))
  if (key === todayKey) return `Hoy · ${written}`
  const tomorrow = new Date(new Date(`${todayKey}T12:00:00Z`).getTime() + 86400000)
  if (key === dateKeyInZone(tomorrow, timeZone)) return `Mañana · ${written}`
  return written
}

function durationLabel(start?: string | null, end?: string | null) {
  if (!start || !end) return ''
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Bloque común con los datos de la cita: fecha, hora, servicio, profesional y dirección. */
function appointmentBlock(business: NotificationBusiness, appointment: NotificationAppointment) {
  const lines: string[] = []
  lines.push(`🗓️ *${longDate(appointment.start, business.timezone)}*`)
  const duration = durationLabel(appointment.start, appointment.end)
  lines.push(`⏰ *${formatTimeInZone(appointment.start, business.timezone)} h*${duration ? ` · ${duration}` : ''}`)
  if (appointment.serviceName) lines.push(`💅 ${appointment.serviceName}`)
  if (appointment.professionalName) lines.push(`👤 ${appointment.professionalName}`)
  if (business.address) lines.push(`📍 ${business.address}`)
  if (business.maps_url) lines.push(`🗺️ ${business.maps_url}`)
  return lines.join('\n')
}

function header(icon: string, title: string, businessName: string) {
  return `${icon} *${title}*\n_${businessName}_`
}

function greeting(clientName?: string | null) {
  const name = firstName(clientName)
  return name ? `Hola ${name} 👋` : 'Hola 👋'
}

function compose(parts: Array<string | null | undefined>) {
  return parts.filter((part) => typeof part === 'string' && part.trim().length > 0).join('\n\n')
}

function reasonBlock(payload: Record<string, unknown>) {
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
  const actor = typeof payload.actor === 'string' ? payload.actor.trim() : ''
  if (!reason && !actor) return null
  const lines: string[] = []
  if (reason) lines.push(`💬 *Motivo:* ${reason}`)
  if (actor) lines.push(`✍️ *Lo hizo:* ${actor}`)
  return lines.join('\n')
}

function changedMessage(context: NotificationContext): BuiltNotification | null {
  const { business, appointment } = context
  const payload = context.payload ?? {}
  const kind = typeof payload.kind === 'string' ? payload.kind : 'RESCHEDULE'
  const reason = reasonBlock(payload)
  const oldStart = typeof payload.oldStart === 'string' ? payload.oldStart : null

  if (kind === 'CANCEL') {
    return {
      espera: {
        expects: 'YES_NO',
        question: 'Le avisamos que le cancelamos la hora y le ofrecimos buscarle un horario nuevo.',
        ttlHours: 72,
        ...YA_ESTA_CANCELADA,
      },
      subject: `Tu hora en ${business.name} fue cancelada`,
      text: compose([
        header('❌', 'Tu hora fue cancelada', business.name),
        greeting(context.clientName),
        appointment ? `Cancelamos esta hora:\n\n${appointmentBlock(business, appointment)}` : 'Cancelamos tu hora.',
        reason,
        SEPARATOR,
        'Lo sentimos mucho. Si quieres, respóndeme por aquí y te busco un nuevo horario que te acomode. 🙏',
      ]),
    }
  }

  if (kind === 'RESIZE') {
    const oldMinutes = Number(payload.oldMinutes)
    const newMinutes = Number(payload.newMinutes)
    const detail = Number.isFinite(oldMinutes) && Number.isFinite(newMinutes)
      ? `⏱️ *Duración:* ${oldMinutes} min → *${newMinutes} min*`
      : null
    return {
      espera: {
        expects: 'YES_NO',
        question: 'Le avisamos que cambiamos cuánto dura su hora y le preguntamos si le acomoda así.',
        ttlHours: 72,
        ...LE_ACOMODA_O_NO,
      },
      subject: `Cambio en tu hora en ${business.name}`,
      text: compose([
        header('🔄', 'Cambiamos la duración de tu hora', business.name),
        greeting(context.clientName),
        appointment ? `Tu hora sigue igual, solo cambia cuánto dura:\n\n${appointmentBlock(business, appointment)}` : null,
        detail,
        reason,
        SEPARATOR,
        '¿Te acomoda así? Si no puedes, dímelo por aquí y lo reagendamos. 😊',
      ]),
    }
  }

  if (kind === 'MOVE') {
    const oldProfessional = typeof payload.oldProfessional === 'string' ? payload.oldProfessional : null
    const newProfessional = typeof payload.newProfessional === 'string' ? payload.newProfessional : null
    const change = oldProfessional && newProfessional && oldProfessional !== newProfessional
      ? `🔁 *Profesional:* ${oldProfessional} → *${newProfessional}*`
      : null
    return {
      espera: {
        expects: 'YES_NO',
        question: 'Le avisamos que le cambiamos la hora (o el profesional) y le pedimos que responda SÍ si le acomoda o NO para buscarle otro horario.',
        ttlHours: 72,
        ...LE_ACOMODA_O_NO,
      },
      subject: `Cambio en tu hora en ${business.name}`,
      text: compose([
        header('🔄', 'Cambiamos tu hora', business.name),
        greeting(context.clientName),
        oldStart ? `Tu hora era el *${longDate(oldStart, business.timezone).toLowerCase()}* a las *${formatTimeInZone(oldStart, business.timezone)} h*.` : null,
        appointment ? `Quedó así:\n\n${appointmentBlock(business, appointment)}` : null,
        change,
        reason,
        SEPARATOR,
        '¿Te acomoda? Responde *SÍ* para confirmar, o dime *NO* y te busco otro horario. 😊',
      ]),
    }
  }

  return {
    espera: {
      expects: 'YES_NO',
      question: 'Le avisamos que le cambiamos la hora y le pedimos que responda SÍ si le acomoda o NO para buscarle otro horario.',
      ttlHours: 72,
      ...LE_ACOMODA_O_NO,
    },
    subject: `Cambio en tu hora en ${business.name}`,
    text: compose([
      header('🔄', 'Cambiamos tu hora', business.name),
      greeting(context.clientName),
      oldStart ? `Tu hora era el *${longDate(oldStart, business.timezone).toLowerCase()}* a las *${formatTimeInZone(oldStart, business.timezone)} h*.` : null,
      appointment ? `Quedó así:\n\n${appointmentBlock(business, appointment)}` : null,
      reason,
      SEPARATOR,
      '¿Te acomoda? Responde *SÍ* para confirmar, o dime *NO* y te busco otro horario. 😊',
    ]),
  }
}

export function buildNotification(eventType: string, context: NotificationContext): BuiltNotification | null {
  const { business, appointment } = context
  const payload = context.payload ?? {}

  switch (eventType) {
    case 'BOOKED':
      if (!appointment) return null
      return {
        espera: {
          expects: 'FREE',
          question: 'Le confirmamos que su hora quedó agendada y le dijimos que nos escriba si necesita cambiarla o cancelarla.',
          ttlHours: 48,
          ...CONFIRMAR_O_LIBERAR,
        },
        subject: `Tu hora en ${business.name} quedó agendada`,
        text: compose([
          header('✅', 'Tu hora quedó agendada', business.name),
          greeting(context.clientName),
          appointmentBlock(business, appointment),
          SEPARATOR,
          '¡Te esperamos! Si necesitas cambiarla o cancelarla, respóndeme por aquí. 😊',
        ]),
      }

    case 'CHANGED':
      return changedMessage(context)

    case 'RESCHEDULED':
      return changedMessage({ ...context, payload: { ...payload, kind: 'RESCHEDULE' } })

    case 'CANCELLED':
      return changedMessage({ ...context, payload: { ...payload, kind: 'CANCEL' } })

    case 'CONFIRM_REQUEST':
      if (!appointment) return null
      return {
        espera: {
          expects: 'YES_NO',
          question: 'Le pedimos que responda SÍ para dejar confirmada su hora, o NO si no puede venir y así liberamos el cupo.',
          ttlHours: 24,
          ...CONFIRMAR_O_LIBERAR,
        },
        subject: `¿Confirmas tu hora en ${business.name}?`,
        text: compose([
          header('📋', '¿Confirmamos tu hora?', business.name),
          greeting(context.clientName),
          `Te recuerdo tu hora:\n\n${appointmentBlock(business, appointment)}`,
          SEPARATOR,
          'Responde *SÍ* si vas a venir y la dejo confirmada.\nSi no puedes, responde *NO* y te busco otro horario — así le damos el cupo a alguien más. 🙌',
        ]),
      }

    case 'DAY_OF_REMINDER':
      if (!appointment) return null
      return {
        espera: {
          expects: 'YES_NO',
          question: 'Le recordamos que hoy tiene hora y le pedimos que responda SÍ para confirmar que viene, o NO para liberar el cupo.',
          ttlHours: 12,
          ...CONFIRMAR_O_LIBERAR,
        },
        subject: `Hoy tienes hora en ${business.name}`,
        text: compose([
          header('☀️', 'Hoy tienes tu hora', business.name),
          greeting(context.clientName),
          appointmentBlock(business, appointment),
          SEPARATOR,
          'Responde *SÍ* para confirmar que vienes.\nSi no puedes, responde *NO* y liberamos el cupo. 🙏',
        ]),
      }

    case 'REMINDER_24H':
    case 'REMINDER_2H':
      if (!appointment) return null
      return {
        espera: {
          expects: 'FREE',
          question: 'Le recordamos su hora y le dijimos que nos escriba si no puede venir, para reagendarla.',
          ttlHours: 24,
          ...CONFIRMAR_O_LIBERAR,
        },
        subject: `Recordatorio de tu hora en ${business.name}`,
        text: compose([
          header('⏰', 'Recordatorio de tu hora', business.name),
          greeting(context.clientName),
          appointmentBlock(business, appointment),
          SEPARATOR,
          'Si no puedes venir, respóndeme por aquí y lo reagendamos. 😊',
        ]),
      }

    case 'WAITLIST_SLOT': {
      const slotStart = typeof payload.slotStart === 'string' ? payload.slotStart : null
      if (!slotStart) return null
      const serviceName = typeof payload.serviceName === 'string' ? payload.serviceName : null
      const professionalName = typeof payload.professionalName === 'string' ? payload.professionalName : null
      return {
        espera: {
          expects: 'YES_NO',
          question: 'Estaba en la lista de espera: le ofrecimos un cupo que se liberó y le pedimos que responda SÍ si lo quiere.',
          ttlHours: 6,
          ...CUPO_LIBERADO,
        },
        subject: `Se liberó un cupo en ${business.name}`,
        text: compose([
          header('🔔', '¡Se liberó un cupo!', business.name),
          greeting(context.clientName),
          'Estabas en la lista de espera y quedó una hora disponible:',
          appointmentBlock(business, { start: slotStart, serviceName, professionalName }),
          SEPARATOR,
          'Si la quieres, respóndeme *SÍ* y te la agendo enseguida. Es por orden de llegada. ⚡',
        ]),
      }
    }

    case 'FOLLOW_UP':
      return {
        espera: {
          expects: 'YES_NO',
          question: 'Le escribimos porque hace tiempo que no viene (o no pudo asistir) y le ofrecimos buscarle un nuevo horario.',
          ttlHours: 72,
          ...OFRECER_HORARIOS,
        },
        subject: `Te echamos de menos en ${business.name}`,
        text: compose([
          header('💬', '¿Todo bien?', business.name),
          greeting(context.clientName),
          appointment
            ? `Vimos que no pudiste venir a tu hora del *${longDate(appointment.start, business.timezone).toLowerCase()}*.`
            : 'Hace tiempo que no nos vemos.',
          SEPARATOR,
          '¿Te busco un nuevo horario? Respóndeme por aquí y lo vemos al tiro. 😊',
        ]),
      }

    case 'REVIEW_REQUEST':
      return {
        espera: {
          expects: 'RATING',
          question: 'Le pedimos que califique su visita del 1 al 5 y, si quiere, que cuente por qué.',
          ttlHours: 72,
          ifYes: 'Agradécele en una línea y guarda lo que dijo con guardar_memoria. No ofrezcas nada más salvo que él lo pida.',
          ifNo: 'No quiere responder: agradécele igual en una línea y no insistas.',
        },
        subject: `¿Cómo te fue en ${business.name}?`,
        text: compose([
          header('⭐', '¿Cómo te fue?', business.name),
          greeting(context.clientName),
          'Nos ayudaría mucho saber qué te pareció tu visita.',
          SEPARATOR,
          'Respóndeme con una nota del 1 al 5 y, si quieres, cuéntame por qué. ¡Gracias! 🙏',
        ]),
      }

    default:
      return null
  }
}
