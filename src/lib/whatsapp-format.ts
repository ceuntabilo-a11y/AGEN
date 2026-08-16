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
 * Un dato secundario de una opción: el precio o la duración.
 *
 * Se buscan TODAS las apariciones, no la primera. Esa es la corrección del fallo que se veía en
 * producción: una opción puede llevar dos servicios («Corte — Valentina — $15.000 + Manicura —
 * Fernanda — $14.000») y ahí no hay un dato final que bajar, hay dos opciones encadenadas.
 */
const DATO = /(?:\$\s?[\d.,]+|\b\d+\s*(?:min|minutos|hrs?\.?|horas?)\b)/gi

/** Separadores que pueden preceder al dato secundario dentro de una opción. */
const SEPARADOR = /[—–·|-]/

/**
 * El `+` que encadena dos servicios en una misma opción. Se parte por él para que cada servicio
 * quede con SU precio y no con el del vecino.
 */
const ENCADENADOR = /\s+\+\s+/

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

/** La negrita solo se pone si la cabecera es corta y no traía asteriscos propios. */
function enNegrita(cabeza: string) {
  if (yaEstaEnNegrita(cabeza) || cabeza.includes('*') || cabeza.length > LARGO_MAXIMO_DE_CABECERA) return cabeza
  return `*${cabeza}*`
}

/**
 * Corta la opción justo antes de su dato secundario, por el separador que lo antecede.
 *
 * Devuelve `null` si no hay separador antes del dato: sin él no hay dónde cortar sin inventarse
 * un salto en mitad de una frase.
 */
function partirPorElDato(item: string, posicionDelDato: number) {
  const antes = item.slice(0, posicionDelDato)
  const corte = antes.search(new RegExp(`\\s*${SEPARADOR.source}\\s*$`))
  if (corte <= 0) return null
  return { cabeza: antes.slice(0, corte).trim(), dato: item.slice(posicionDelDato).trim() }
}

/**
 * Una opción con UN solo dato pasa de «• 13:00 con Camila Rojas — $15.000» a dos líneas:
 * la cabecera en negrita y el dato secundario debajo.
 */
function bloqueSimple(item: string, posicionDelDato: number) {
  const partido = partirPorElDato(item, posicionDelDato)
  if (!partido || !partido.cabeza) return enNegrita(item)
  return `${enNegrita(partido.cabeza)}\n${partido.dato}`
}

/**
 * Una opción que encadena dos servicios con `+` se parte por el `+`, un servicio por línea.
 *
 * No se le baja el precio a su propia línea: con dos precios en juego, bajar el primero lo dejaba
 * pegado al nombre del segundo profesional. Visto en producción (ejecución 9236 del n8n):
 * «*1) Corte y Peinado — Valentina Soto*\n$15.000 + Manicura Semipermanente — Fernanda Muñoz —
 * $14.000», donde $15.000 parecía el precio de la manicura.
 */
function bloqueEncadenado(item: string) {
  const partes = item.split(ENCADENADOR)
  if (partes.length < 2) return item
  /*
   * Sin negrita, a propósito: acá la cabecera ya lleva su precio dentro, y marcar en negrita la
   * línea entera —precio incluido— no señala nada. La jerarquía la da el salto de línea.
   * El `+` es contenido: se conserva al principio de cada línea siguiente.
   */
  const [primera, ...resto] = partes
  return [primera.trim(), ...resto.map((parte) => `+ ${parte.trim()}`)].join('\n')
}

/**
 * Ordena una opción de la lista. La decisión se toma contando sus datos secundarios, no buscando
 * el primero que aparezca.
 */
function bloqueDeOpcion(item: string) {
  DATO.lastIndex = 0
  const posiciones: number[] = []
  for (let hallazgo = DATO.exec(item); hallazgo; hallazgo = DATO.exec(item)) posiciones.push(hallazgo.index)
  if (posiciones.length === 0) return enNegrita(item)
  if (posiciones.length > 1) return bloqueEncadenado(item)
  return bloqueSimple(item, posiciones[0])
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
