import { test, expect } from '@playwright/test'
import { sharpenRGBA } from '@/lib/image-sharpen'

/**
 * Tanda 7: nitidez de la foto del profesional. Solo la parte que no necesita `<canvas>` ni
 * navegador se prueba acá — el resto (recortar el fondo, componer con el color de marca o un
 * fondo con IA) pasa por `@imgly/background-removal` y `<canvas>`, que no corren en Node.
 */

/** Arma una imagen plana de w×h con el mismo color RGBA en todos los píxeles. */
function imagenPlana(w: number, h: number, [r, g, b, a]: [number, number, number, number]) {
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) pixels.set([r, g, b, a], i * 4)
  return pixels
}

test.describe('Nitidez (sharpenRGBA)', () => {
  test('una imagen de un solo color no cambia: no hay ningún borde que realzar', () => {
    const plana = imagenPlana(4, 4, [120, 80, 200, 255])
    const resultado = sharpenRGBA(plana, 4, 4)
    expect(Array.from(resultado)).toEqual(Array.from(plana))
  })

  test('el canal alfa (transparencia del recorte) se conserva exacto', () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4)
    for (let i = 0; i < 9; i++) pixels.set([255, 0, 0, i % 2 === 0 ? 255 : 0], i * 4)
    const resultado = sharpenRGBA(pixels, 3, 3)
    for (let i = 0; i < 9; i++) expect(resultado[i * 4 + 3]).toBe(pixels[i * 4 + 3])
  })

  test('un punto claro en medio de un fondo parejo se realza (más contraste, no menos)', () => {
    const pixels = imagenPlana(3, 3, [100, 0, 0, 255])
    const centro = (1 * 3 + 1) * 4
    pixels[centro] = 200 // rojo, solo el píxel central, por encima del fondo (100)
    const resultado = sharpenRGBA(pixels, 3, 3)
    // El punto brillante se satura hacia arriba: 5×200 - 4×100 = 600 → clamp a 255.
    expect(resultado[centro]).toBe(255)
    // Su vecino ortogonal (arriba) baja por debajo del fondo original: es el halo oscuro
    // que hace que el punto claro se vea más definido, la firma de un realce real.
    const vecino = (0 * 3 + 1) * 4
    expect(resultado[vecino]).toBeLessThan(pixels[vecino])
  })

  test('no revienta en los bordes de la imagen', () => {
    const pixels = imagenPlana(2, 2, [10, 20, 30, 255])
    expect(() => sharpenRGBA(pixels, 2, 2)).not.toThrow()
  })
})
