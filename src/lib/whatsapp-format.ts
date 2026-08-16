/**
 * Capa de PRESENTACIÓN de la respuesta del agente en WhatsApp.
 *
 * Qué hace: ordena visualmente el texto que el modelo ya decidió enviar — separa ideas, deshace
 * los bloques amontonados, convierte una lista de opciones en bloques legibles y deja respirar la
 * pregunta final.
 *
 * Qué NO hace, por construcción y no por cuidado: no cambia una sola letra ni un solo dígito.
 * Solo puede insertar saltos de línea, quitar viñetas y separadores, y poner asteriscos de
 * negrita. `mismaSustancia()` lo comprueba antes de devolver nada: si la firma del texto (todas
 * sus letras y números, en minúsculas) no es idéntica a la del original, se devuelve el original
 * tal cual. Así es imposible que esta capa reformule, añada, quite o reordene contenido.
 *
 * Tampoco toca los mensajes automáticos (recordatorios, avisos, campañas): esos tienen sus
 * propias plantillas en `@/lib/notification-templates` y ya salen ordenados.
 *
 * Coste: una función pura sobre una cadena. Ni red, ni base de datos, ni una segunda llamada al
 * modelo.
 */

/** Más largo que esto ya no es una respuesta de WhatsApp: se deja como estaba. */
const LARGO_MAXIMO = 1200

/** Un mensaje corto de una sola idea ya se lee bien: no se le hace nada. */
const LARGO_MINIMO_PARA_ORDENAR = 90

/** Viñeta al principio de línea. El `*` solo cuenta si le sigue un espacio (si no, es negrita). */
const VINETA = /^\s*(?:[•·▪◦]|[-–—]\s|\*\s)\s*/

/**
 * Lista numerada. Se reconoce como lista, pero el número **no se quita**: es un dígito, o sea
 * contenido, y esta capa no borra contenido. Se queda dentro de la cabecera.
 */
const NUMERACION = /^\s*\d+[.)]\s/

/**
 * Cola de dato de una opción: el precio o la duración que va al final, tras un separador.
 * Es lo que se baja a su propia línea para que la hora y el profesional queden solos arriba.
 */
const COLA_DE_DATO = /\s*[—–·|-]\s*((?:\$\s?[\d.,]+|\d+\s*(?:min|minutos|hrs?|horas?))\b.*)$/i

/** Una cabecera se pone en negrita solo si es corta: una frase entera en negrita no es jerarquía. */
const LARGO_MAXIMO_DE_CABECERA = 64

/**
 * Lo único que esta capa tiene permitido tocar: espacios y saltos, viñetas, asteriscos de
 * negrita y los separadores que se convierten en salto de línea.
 */
const SOLO_FORMATO = /[\s*•·▪◦—–|-]/g

/**
 * El texto sin nada de formato. Dos textos con la misma firma dicen exactamente lo mismo:
 * mismas letras, mismos números, misma puntuación, mismos emojis y en el mismo orden.
 */
function firma(texto: string) {
  return texto.replace(SOLO_FORMATO, '').toLowerCase()
}

function mismaSustancia(original: string, formateado: string) {
  return firma(original) === firma(formateado)
}

/** ¿La línea ya viene en negrita entera? Entonces no se toca. */
function yaEstaEnNegrita(linea: string) {
  return /^\*[^*]+\*$/.test(linea.trim())
}

/**
 * Una opción de la lista pasa de «• 13:00 con Camila Rojas — $15.000» a dos líneas:
 * la cabecera en negrita y el dato secundario debajo.
 */
function bloqueDeOpcion(item: string) {
  const cola = item.match(COLA_DE_DATO)
  const cabeza = (cola ? item.slice(0, item.length - cola[0].length) : item).trim()
  const resto = cola ? cola[1].trim() : ''

  const enNegrita = !yaEstaEnNegrita(cabeza) && cabeza.length <= LARGO_MAXIMO_DE_CABECERA && !cabeza.includes('*')
    ? `*${cabeza}*`
    : cabeza
  return resto ? `${enNegrita}\n${resto}` : enNegrita
}

/**
 * Separa la pregunta final para que no quede pegada al dato anterior.
 *
 * Solo la última pregunta, solo si es corta y solo si va al final: partir cualquier interrogación
 * del medio troceaba mensajes que se leían bien.
 */
function despegarPreguntaFinal(texto: string) {
  const inicio = texto.lastIndexOf('¿')
  if (inicio <= 0) return texto
  const pregunta = texto.slice(inicio).trim()
  if (!/\?/.test(pregunta) || pregunta.length > 120) return texto
  const antes = texto.slice(0, inicio).trimEnd()
  if (!antes) return texto
  return `${antes}\n\n${pregunta}`
}

/**
 * Ordena el texto ya decidido por el agente. Devuelve el original si ordenarlo cambiaría lo que
 * dice, si no hay nada que ordenar, o si el resultado se pasa de largo.
 */
export function formatearParaWhatsApp(original: string): string {
  const texto = String(original ?? '')
  const base = texto.trim()
  if (!base) return texto

  const esItem = (linea: string) => VINETA.test(linea) || NUMERACION.test(linea)
  const tieneLista = base.split('\n').filter(esItem).length >= 2
  // Un mensaje corto y sin lista ya se lee bien tal cual.
  if (!tieneLista && base.length < LARGO_MINIMO_PARA_ORDENAR) return texto

  const bloques: string[] = []
  let sueltas: string[] = []
  const volcarSueltas = () => {
    if (sueltas.length) bloques.push(sueltas.join('\n'))
    sueltas = []
  }

  for (const cruda of base.split('\n')) {
    const linea = cruda.trim()
    if (!linea) { volcarSueltas(); continue }
    if (esItem(linea)) {
      volcarSueltas()
      bloques.push(bloqueDeOpcion(linea.replace(VINETA, '').trim()))
      continue
    }
    sueltas.push(linea)
  }
  volcarSueltas()

  // Un bloque por idea, separados por una línea en blanco: es lo que deshace el amontonamiento.
  let resultado = bloques.filter(Boolean).join('\n\n')
  resultado = despegarPreguntaFinal(resultado).replace(/\n{3,}/g, '\n\n').trim()

  if (resultado === base) return texto
  if (resultado.length > LARGO_MAXIMO) return texto
  // La red de seguridad: si cambió una sola letra o un solo número, no se usa.
  if (!mismaSustancia(base, resultado)) return texto
  return resultado
}
