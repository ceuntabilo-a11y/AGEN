import { formatInZone, formatTimeInZone } from '@/lib/timezone'

/**
 * Los mensajes de confirmación, escritos con lo que devolvió la BASE DE DATOS.
 *
 * Requisito 4 del encargo, y el cierre definitivo del fallo que originó todo esto: hasta ahora
 * el texto de «tu hora quedó reservada» lo redactaba el modelo, así que podía decirlo sin que
 * existiera la reserva, o decir un día y una hora distintos de los guardados. Acá el texto se
 * construye con los campos de la fila real; el modelo ni participa.
 *
 * Son funciones puras: entran datos, sale una cadena. Por eso se pueden probar sin base de
 * datos, sin red y sin modelo.
 */

export type DatosDeReserva = {
  start: string
  serviceName?: string | null
  professionalName?: string | null
  timezone: string
}

function cuando(datos: DatosDeReserva) {
  const dia = formatInZone(datos.start, datos.timezone, { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')
  return `${dia} a las ${formatTimeInZone(datos.start, datos.timezone)}`
}

function conQuien(datos: DatosDeReserva) {
  const partes = [datos.serviceName, datos.professionalName ? `con ${datos.professionalName}` : null].filter(Boolean)
  return partes.join(' ')
}

/** Cierra el mensaje pidiendo UN dato que falte, con su motivo (requisitos 13 y 14). */
export function conPeticionDeDato(texto: string, pregunta: string | null) {
  return pregunta ? `${texto}\n\n${pregunta}` : texto
}

export function textoReservaHecha(datos: DatosDeReserva) {
  const detalle = conQuien(datos)
  return `Listo, tu hora quedó reservada 🙌\n\n${detalle ? `${detalle}\n` : ''}${cuando(datos)}\n\nSi necesitas cambiarla o cancelarla, escríbeme por aquí.`
}

export function textoReservaMovida(datos: DatosDeReserva) {
  const detalle = conQuien(datos)
  return `Listo, cambié tu hora ✅\n\n${detalle ? `${detalle}\n` : ''}Queda para el ${cuando(datos)}.`
}

export function textoReservaCancelada(datos: DatosDeReserva) {
  return `Listo, cancelé tu hora del ${cuando(datos)}.\n\n¿Quieres que te busque otro horario?`
}

export function textoReservaConfirmada(datos: DatosDeReserva) {
  const detalle = conQuien(datos)
  return `Perfecto, dejé tu hora confirmada ✅\n\n${detalle ? `${detalle}\n` : ''}${cuando(datos)}\n\nTe esperamos.`
}

export function textoYaEstabaCancelada(datos: DatosDeReserva) {
  return `Esa hora del ${cuando(datos)} ya estaba cancelada.\n\n¿Quieres que te busque otro horario?`
}

export function textoYaEstabaConfirmada(datos: DatosDeReserva) {
  return `Tu hora del ${cuando(datos)} ya estaba confirmada. Te esperamos 😊`
}

/** El horario se ocupó entre que se ofreció y el cliente contestó. */
export const TEXTO_CUPO_OCUPADO =
  'Uy, ese horario acaba de tomarlo otra persona 😕\n\n¿Quieres que te busque otras horas para el mismo día?'

export const TEXTO_NO_SE_PUDO =
  'Tuve un problema al guardar el cambio y prefiero no dejarlo a medias.\n\n¿Quieres que lo intente de nuevo?'

export const TEXTO_SIN_RESERVAS =
  'No encuentro ninguna hora reservada a tu nombre.\n\n¿Quieres que te busque una?'

export function textoVariasReservas(reservas: Array<{ date: string; time: string; serviceName?: string | null }>) {
  const lista = reservas.map((reserva) => `- ${reserva.date} a las ${reserva.time}${reserva.serviceName ? ` · ${reserva.serviceName}` : ''}`).join('\n')
  return `Tienes más de una hora reservada:\n\n${lista}\n\n¿Sobre cuál quieres que actuemos?`
}

export function textoEquipoAvisado(avisado: boolean, telefonoNegocio: string | null) {
  return avisado
    ? 'Ya le avisé al equipo y te van a contactar por aquí. 🙌'
    : `No pude dejar el aviso al equipo.${telefonoNegocio ? ` Puedes llamarlos directamente al ${telefonoNegocio}.` : ''}`
}
