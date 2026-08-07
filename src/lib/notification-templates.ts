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

export type BuiltNotification = { text: string; subject: string }

const SEPARATOR = '━━━━━━━━━━━━━━━'

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
