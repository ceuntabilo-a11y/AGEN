/**
 * Nitidez por convolución (máscara de realce 3x3), sobre píxeles RGBA planos. Sin `<canvas>` ni
 * DOM: así se puede probar sin navegador. El componente que la usa solo se encarga de sacar los
 * píxeles de un `<canvas>`, llamar esta función, y volver a pintarlos.
 */
const NUCLEO = [0, -1, 0, -1, 5, -1, 0, -1, 0]

export function sharpenRGBA(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const resultado = new Uint8ClampedArray(pixels.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destino = (y * width + x) * 4
      for (let canal = 0; canal < 3; canal++) {
        let suma = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const sx = Math.min(width - 1, Math.max(0, x + kx))
            const sy = Math.min(height - 1, Math.max(0, y + ky))
            suma += pixels[(sy * width + sx) * 4 + canal] * NUCLEO[(ky + 1) * 3 + (kx + 1)]
          }
        }
        resultado[destino + canal] = suma
      }
      // El canal alfa (transparencia del recorte) se conserva tal cual: la nitidez es solo de color.
      resultado[destino + 3] = pixels[destino + 3]
    }
  }
  return resultado
}
