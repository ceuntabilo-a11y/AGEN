/**
 * Buscador del Centro de ayuda (Tanda 9): entiende preguntas parecidas SIN llamar a ningún
 * modelo de IA — cero costo por pregunta, y funciona sin conexión al proveedor de IA del
 * negocio. En vez de eso, cada artículo trae una lista de "alias" (formas distintas de
 * preguntar lo mismo, escritas a mano) y el buscador compara por palabras, tolerando errores
 * de tipeo chicos (una o dos letras de diferencia).
 */

export type ArticuloAyuda = {
  id: string
  categoria: string
  pregunta: string
  /** Otras formas de preguntar lo mismo: sinónimos, jerga, la palabra exacta del botón. */
  alias: string[]
  respuesta: string
}

const PALABRAS_VACIAS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'por', 'para', 'que',
  'como', 'y', 'o', 'a', 'mi', 'tu', 'su', 'es', 'son', 'hay', 'con', 'sin', 'al', 'lo', 'se',
  'me', 'le', 'les', 'no', 'si', 'puedo', 'quiero', 'donde', 'dónde', 'cual', 'cuál', 'que',
])

function normalizar(texto: string): string {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function tokenizar(texto: string): string[] {
  return normalizar(texto).replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter((palabra) => palabra.length > 1 && !PALABRAS_VACIAS.has(palabra))
}

/** Distancia de edición, acotada: para palabras cortas alcanza con 1-2 letras de diferencia. */
function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1
  const fila = Array.from({ length: b.length + 1 }, (_, indice) => indice)
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0]
    fila[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temporal = fila[j]
      fila[j] = a[i - 1] === b[j - 1] ? anterior : 1 + Math.min(anterior, fila[j], fila[j - 1])
      anterior = temporal
    }
  }
  return fila[b.length]
}

function puntajePalabra(consulta: string, candidata: string): number {
  if (consulta === candidata) return 3
  if (candidata.startsWith(consulta) || consulta.startsWith(candidata)) return 2
  const tope = consulta.length <= 4 ? 1 : 2
  return distancia(consulta, candidata, tope) <= tope ? 1 : 0
}

function textoBuscable(articulo: ArticuloAyuda): string[] {
  return [...tokenizar(articulo.pregunta), ...articulo.alias.flatMap(tokenizar), ...tokenizar(articulo.categoria)]
}

export function buscarAyuda(consulta: string, articulos: ArticuloAyuda[], limite = 6): ArticuloAyuda[] {
  const palabras = tokenizar(consulta)
  if (!palabras.length) return []

  const puntuados = articulos.map((articulo) => {
    const candidatas = textoBuscable(articulo)
    const puntaje = palabras.reduce((suma, palabra) => {
      const mejor = candidatas.reduce((max, candidata) => Math.max(max, puntajePalabra(palabra, candidata)), 0)
      return suma + mejor
    }, 0)
    return { articulo, puntaje }
  })

  return puntuados
    .filter((item) => item.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, limite)
    .map((item) => item.articulo)
}
