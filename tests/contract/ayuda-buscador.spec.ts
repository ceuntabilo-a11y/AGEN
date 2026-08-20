import { test, expect } from '@playwright/test'
import { buscarAyuda, type ArticuloAyuda } from '../../src/lib/help-search'
import { ARTICULOS_AYUDA } from '../../src/lib/help-content'

const ARTICULOS: ArticuloAyuda[] = [
  { id: 'a1', categoria: 'Agenda', pregunta: '¿Cómo hago una reserva a mano?', alias: ['agendar una hora', 'reservar para un cliente'], respuesta: 'Agenda → Nueva reserva.' },
  { id: 'a2', categoria: 'Finanzas', pregunta: '¿Cómo cobro algo?', alias: ['registrar un pago', 'anotar un cobro'], respuesta: 'Finanzas → Registrar cobro.' },
  { id: 'a3', categoria: 'Marketing', pregunta: '¿Cómo le escribo a mis clientes con una promoción?', alias: ['mandar una campaña', 'enviar promociones'], respuesta: 'Marketing → Nueva campaña.' },
]

test.describe('buscarAyuda', () => {
  test('consulta vacía no devuelve nada', () => {
    expect(buscarAyuda('', ARTICULOS)).toEqual([])
    expect(buscarAyuda('   ', ARTICULOS)).toEqual([])
  })

  test('encuentra por coincidencia exacta de la pregunta', () => {
    const resultado = buscarAyuda('cómo cobro algo', ARTICULOS)
    expect(resultado[0]?.id).toBe('a2')
  })

  test('encuentra por alias aunque no aparezca en la pregunta', () => {
    const resultado = buscarAyuda('registrar un pago', ARTICULOS)
    expect(resultado[0]?.id).toBe('a2')
  })

  test('entiende una pregunta parafraseada con palabras distintas', () => {
    const resultado = buscarAyuda('mandar una campaña de marketing', ARTICULOS)
    expect(resultado[0]?.id).toBe('a3')
  })

  test('tolera un error de tipeo chico', () => {
    const resultado = buscarAyuda('como agendo una ora', ARTICULOS)
    expect(resultado[0]?.id).toBe('a1')
  })

  test('no devuelve nada si no hay ninguna coincidencia razonable', () => {
    const resultado = buscarAyuda('xyzabc123 zzz', ARTICULOS)
    expect(resultado).toEqual([])
  })

  test('respeta el límite de resultados', () => {
    const resultado = buscarAyuda('como', ARTICULOS, 1)
    expect(resultado.length).toBeLessThanOrEqual(1)
  })

  test('la base de conocimiento real no tiene ids repetidos', () => {
    const ids = ARTICULOS_AYUDA.map((articulo) => articulo.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('la base de conocimiento real responde a una búsqueda parafraseada típica', () => {
    const resultado = buscarAyuda('no me deja borrar un cliente', ARTICULOS_AYUDA)
    expect(resultado.map((articulo) => articulo.id)).toContain('clientes-eliminar')
  })

  test('la base de conocimiento real encuentra la foto de profesional aunque se pregunte distinto', () => {
    const resultado = buscarAyuda('quiero cambiar la imagen de un estilista', ARTICULOS_AYUDA)
    expect(resultado.map((articulo) => articulo.id)).toContain('equipo-foto-profesional')
  })
})
