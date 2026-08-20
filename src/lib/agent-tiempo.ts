import type { ReferenciasTemporales } from '@/lib/timezone'

/**
 * Cuándo quiere venir el cliente, entendido por CÓDIGO.
 *
 * Fallo real en producción (conversación del 2026-08-17, 16:30): el cliente dijo «En la tarde»,
 * «3pm», «Preferiblemente» y después «Para mañana a las 3 de la tarde por favor», y el agente
 * siguió ofreciéndole las 09:00 y preguntándole a qué se refería. Cuatro turnos gastados en un
 * dato que estaba escrito con todas sus letras.
 *
 * La hora no es una opinión: «3pm», «15:00», «3 de la tarde» y «después del almuerzo» son la
 * misma franja y se pueden resolver con una tabla. Pedirle eso a un modelo es pagar tokens y
 * arriesgar un error en algo que no admite interpretación.
 *
 * Lo que sale de aquí se le da ya resuelto al agente (`PEDIDO` en el contexto) y decide además
 * si un mensaje habla de OTRO horario distinto del que ya se le ofreció — que es lo que
 * distingue «elegir» de «buscar otra cosa».
 */

export type FranjaDelDia = 'mañana' | 'tarde' | 'noche'

export type CuandoPedido = {
  /** Día resuelto en la zona del negocio, `AAAA-MM-DD`. */
  fecha: string | null
  /** Cómo lo dijo el cliente: «mañana», «el martes», «hoy». */
  dia: string | null
  franja: FranjaDelDia | null
  /** Hora exacta si la dijo, `HH:MM`. */
  hora: string | null
  /** Ventana de búsqueda, lista para `buscar_horarios`. */
  desde: string | null
  hasta: string | null
}

const VACIO: CuandoPedido = { fecha: null, dia: null, franja: null, hora: null, desde: null, hasta: null }

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const

/** Rangos horarios de cada franja, en hora local del negocio. */
const RANGO_FRANJA: Record<FranjaDelDia, [number, number]> = {
  mañana: [8, 13],
  tarde: [13, 19],
  noche: [18, 22],
}

function sinAcentos(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * La hora exacta, dicha como sea.
 *
 * «3pm», «3 pm», «15:00», «a las 3 de la tarde», «las 15 hrs», «3 y media». El «de la tarde»
 * y el «pm» son los que convierten un 3 en las 15:00, y por eso se leen aquí y no en el modelo.
 */
export function horaDelMensaje(mensaje: string): string | null {
  const texto = sinAcentos(String(mensaje ?? ''))

  // 15:00, 15.30, 15h30
  const conMinutos = /\b([01]?\d|2[0-3])\s*[:.h]\s*([0-5]\d)\b/.exec(texto)
  if (conMinutos) {
    const hora = Number(conMinutos[1])
    const sufijo = texto.slice(conMinutos.index + conMinutos[0].length, conMinutos.index + conMinutos[0].length + 22)
    return `${String(ajustarPorSufijo(hora, sufijo)).padStart(2, '0')}:${conMinutos[2]}`
  }

  // 3pm, 3 pm, 15 hrs, a las 3, las 3 de la tarde, 3 y media
  const suelta = /(?:a\s+las?\s+|las?\s+|desde\s+las?\s+)?\b([01]?\d|2[0-3])\s*(?:hrs?|horas?)?\s*(am|pm|a\.?m\.?|p\.?m\.?)?(?:\s*(y\s+media|y\s+cuarto|en\s+punto))?(?=\s|$|[,.;!?])/.exec(texto)
  if (!suelta) return null
  // Un número suelto sin ninguna pista de que sea una hora no es una hora.
  const contexto = texto.slice(Math.max(0, suelta.index - 14), suelta.index + suelta[0].length + 22)
  const pistaDeHora = /(a\s+las?|las?\s|hrs?|horas?|am|pm|de\s+la\s+(mañana|manana|tarde|noche)|del?\s+mediodia|tipo\s)/.test(contexto)
  if (!pistaDeHora) return null

  const hora = ajustarPorSufijo(Number(suelta[1]), `${suelta[2] ?? ''} ${texto.slice(suelta.index + suelta[0].length, suelta.index + suelta[0].length + 22)}`)
  const minutos = /y\s+media/.test(suelta[3] ?? '') ? '30' : /y\s+cuarto/.test(suelta[3] ?? '') ? '15' : '00'
  return `${String(hora).padStart(2, '0')}:${minutos}`
}

/** «3» + «pm» o «de la tarde» = 15. Sin sufijo, una hora menor que 8 se entiende de tarde. */
function ajustarPorSufijo(hora: number, sufijo: string): number {
  const texto = sinAcentos(sufijo)
  const esTarde = /\bp\.?m\.?\b|de\s+la\s+tarde|de\s+la\s+noche|por\s+la\s+tarde|por\s+la\s+noche/.test(texto)
  const esManana = /\ba\.?m\.?\b|de\s+la\s+mañana|de\s+la\s+manana|por\s+la\s+mañana|por\s+la\s+manana/.test(texto)
  if (esTarde && hora < 12) return hora + 12
  if (esManana && hora === 12) return 0
  if (!esTarde && !esManana && hora >= 1 && hora <= 7) return hora + 12
  return hora
}

/** La franja, dicha de cualquiera de las formas en que la dice una persona. */
export function franjaDelMensaje(mensaje: string): FranjaDelDia | null {
  const texto = sinAcentos(String(mensaje ?? ''))
  if (/\b(de\s+)?(la\s+)?(mañana|manana)\b/.test(texto) && !/\bpara\s+mañana\b|\bmanana\s+(a|por|en)\b/.test(texto)) {
    // «en la mañana» es franja; «para mañana» es día. Se distinguen por la preposición.
    if (/\b(en|por|de)\s+la\s+(mañana|manana)\b|\btempranito?\b|\bal\s+mediodia\b/.test(texto)) return 'mañana'
  }
  if (/\b(en|por|de|a)\s+la\s+tarde\b|\btarde\b(?!\s*$)|despues\s+del\s+almuerzo|post\s*almuerzo|pasado\s+el\s+almuerzo/.test(texto)) return 'tarde'
  if (/\b(en|por|de|a)\s+la\s+noche\b|\bnochecita\b|despues\s+del\s+trabajo/.test(texto)) return 'noche'
  if (/\b(en|por|de)\s+la\s+(mañana|manana)\b|\btemprano\b/.test(texto)) return 'mañana'
  return null
}

/** El día, resuelto contra las referencias que ya calcula el servidor. */
function diaDelMensaje(mensaje: string, time: ReferenciasTemporales | null): { fecha: string | null; dia: string | null } {
  if (!time) return { fecha: null, dia: null }
  const texto = sinAcentos(String(mensaje ?? ''))

  // `fecha` es la del NEGOCIO, ya resuelta por el servidor. `desde` viaja en UTC y al oeste de
  // Greenwich cae en el día anterior: usarlo aquí ofrecería el día equivocado.
  if (/\bpasado\s+mañana\b|\bpasado\s+manana\b/.test(texto)) return { fecha: time.pasadoManana?.fecha ?? null, dia: 'pasado mañana' }
  if (/\bhoy\b|\bahora\b|\beste\s+rato\b|\bal\s+tiro\b/.test(texto)) return { fecha: time.hoy?.fecha ?? null, dia: 'hoy' }
  if (/\bmañana\b|\bmanana\b/.test(texto)) return { fecha: time.manana?.fecha ?? null, dia: 'mañana' }

  for (const nombre of DIAS) {
    if (new RegExp(`\\b${nombre}\\b`).test(texto)) {
      const fecha = (time.proximos as Record<string, string> | undefined)?.[nombre]
      if (fecha) return { fecha, dia: nombre }
    }
  }
  return { fecha: null, dia: null }
}

/**
 * Todo junto: qué día, qué franja y a qué hora, más la ventana lista para buscar.
 *
 * Se aplica sobre el mensaje del turno Y sobre lo que ya se habló, porque una persona dice el
 * día en un mensaje y la hora en el siguiente («Para mañana» … «3pm»).
 *
 * `ultimaPreguntaAgente` es el último mensaje que mandó EL AGENTE, y se mira en último lugar,
 * después de todo lo que dijo el cliente. Fallo real en producción (2026-08-20): el agente
 * preguntó «¿Confirmas Corte y Peinado para mañana a las 14:00?», el cliente tardó más de un
 * día en contestar «Sí, por favor» —sin repetir la hora—, y como el código solo miraba
 * mensajes DEL CLIENTE, PEDIDO llegó vacío: buscó el día completo desde las 00:00 con tope de
 * 3 resultados, que se llenaron con lo primero del día (9:00 de la mañana) sin llegar nunca a
 * revisar las 14:00. El modelo, que sí leyó la conversación completa, entendió igual que el
 * cliente quería las 14:00 y lo dijo en su respuesta — pero la búsqueda nunca se hizo cerca de
 * esa hora.
 *
 * No hace falta filtrarlo por antigüedad como a los mensajes del cliente: acá el riesgo no es
 * que se cuele una fecha vieja de una conversación sin relación (para eso está el filtro de
 * 6 horas en quien llama), es al revés — un «sí» sin fecha propia SIEMPRE está contestando la
 * última pregunta del agente, tenga la hora que tenga la respuesta. Y como «mañana» se vuelve a
 * resolver contra la hora de AHORA (no contra cuándo se escribió la pregunta vieja), nunca
 * apunta a un día ya pasado.
 */
export function interpretarCuando(
  mensaje: string,
  time: ReferenciasTemporales | null,
  anteriores: string[] = [],
  ultimaPreguntaAgente: string | null = null,
): CuandoPedido {
  const propios = [String(mensaje ?? ''), ...anteriores.map((item) => String(item ?? ''))]
  const textos = ultimaPreguntaAgente ? [...propios, String(ultimaPreguntaAgente)] : propios

  const hora = textos.map(horaDelMensaje).find(Boolean) ?? null
  const franja = textos.map(franjaDelMensaje).find(Boolean) ?? (hora ? franjaDeHora(hora) : null)
  const dia = textos.map((texto) => diaDelMensaje(texto, time)).find((item) => item.fecha) ?? { fecha: null, dia: null }

  if (!dia.fecha && !hora && !franja) return VACIO

  // Sin día, la ventana la decide quien llame: acá solo se dice lo que el cliente pidió.
  if (!dia.fecha) return { ...VACIO, hora, franja, dia: null }

  const [desdeHora, hastaHora] = hora
    ? [Number(hora.slice(0, 2)), Math.min(23, Number(hora.slice(0, 2)) + 1)]
    : RANGO_FRANJA[franja ?? 'mañana']

  return {
    fecha: dia.fecha,
    dia: dia.dia,
    franja: franja ?? (hora ? franjaDeHora(hora) : null),
    hora,
    desde: `${dia.fecha}T${String(desdeHora).padStart(2, '0')}:00:00`,
    hasta: `${dia.fecha}T${String(hastaHora).padStart(2, '0')}:00:00`,
  }
}

export function franjaDeHora(hora: string): FranjaDelDia {
  const numero = Number(hora.slice(0, 2))
  if (numero < 13) return 'mañana'
  return numero < 19 ? 'tarde' : 'noche'
}

/**
 * ¿Este mensaje pide un horario DISTINTO de los que ya se le ofrecieron?
 *
 * Es la pregunta que separa «elegir» de «buscar otra cosa». Fallo real: con las 09:00 apartadas
 * y el cliente pidiendo las 15:00, el turno iba al decisor —que no puede buscar— y contestaba
 * «no hay apartados a las 15:00». El cliente repitió tres veces lo mismo.
 */
export function pideOtroHorario(
  mensaje: string,
  apartados: Array<{ hora: string; fecha?: string | null }>,
  time: ReferenciasTemporales | null,
): boolean {
  const pedido = interpretarCuando(mensaje, time)
  if (!pedido.hora && !pedido.franja && !pedido.fecha) return false
  if (!apartados.length) return true

  return !apartados.some((apartado) => {
    if (pedido.hora && apartado.hora !== pedido.hora) return false
    if (pedido.franja && franjaDeHora(apartado.hora) !== pedido.franja) return false
    if (pedido.fecha && apartado.fecha && apartado.fecha !== pedido.fecha) return false
    return true
  })
}
