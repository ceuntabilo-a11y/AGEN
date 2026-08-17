import { dateKeyInZone } from '@/lib/timezone'

/**
 * Datos del cliente que se pueden reconocer SIN modelo.
 *
 * Un correo y una fecha de nacimiento tienen forma: se reconocen con una expresión regular, y
 * hacerlo en código sale gratis, no se equivoca y no gasta un turno del modelo. El nombre no
 * tiene forma —«Ana», «la señora del 3B» y «para mi hija» se parecen demasiado— así que ese sí
 * lo extrae el decisor y se guarda solo cuando viene explícito.
 */

const CORREO = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/

/** dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd y «12 de marzo de 1990». */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function fechaValida(anio: number, mes: number, dia: number): string | null {
  const hoy = new Date()
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  if (anio < 1900 || anio > hoy.getUTCFullYear()) return null
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export function detectarCorreo(mensaje: string): string | null {
  const encontrado = String(mensaje ?? '').match(CORREO)
  return encontrado ? encontrado[0].toLowerCase() : null
}

export function detectarNacimiento(mensaje: string): string | null {
  const texto = String(mensaje ?? '').toLowerCase()

  const iso = texto.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const barras = texto.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/)
  if (barras) return fechaValida(Number(barras[3]), Number(barras[2]), Number(barras[1]))

  const enLetras = texto.match(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+)?(\d{4})\b/)
  if (enLetras) {
    const mes = MESES.findIndex((nombre) => nombre.startsWith(enLetras[2].normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 4)))
    if (mes >= 0) return fechaValida(Number(enLetras[3]), mes + 1, Number(enLetras[1]))
  }
  return null
}

/** ¿Hoy es su cumpleaños, en la zona del negocio? Solo compara día y mes. */
export function esCumpleanosHoy(nacimiento: string | null | undefined, timezone: string): boolean {
  const fecha = String(nacimiento ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false
  return fecha.slice(5) === dateKeyInZone(new Date(), timezone).slice(5)
}

/** Lo que se puede guardar de este mensaje sin preguntarle nada al modelo. */
export function datosSueltosDelMensaje(mensaje: string) {
  return {
    correo: detectarCorreo(mensaje),
    nacimiento: detectarNacimiento(mensaje),
  }
}
