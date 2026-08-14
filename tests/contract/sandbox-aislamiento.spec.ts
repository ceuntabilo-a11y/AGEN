import { test, expect } from '@playwright/test'
import { VARIABLE_SANDBOX, destinoEsLocal, motivoParaNoEscribir } from '../support/sandbox'

/**
 * La guarda que decide si una prueba puede escribir.
 *
 * Se prueba acá, en contrato, porque es lógica pura y porque una guarda de seguridad que no
 * está probada no es una guarda: es una intención. Lo que se fija es que **por defecto no se
 * escribe**. Cualquier duda —destino desconocido, variable ausente, URL rara— tiene que
 * terminar en "no escribas", nunca en "adelante".
 */

const conVariable = (valor: string | undefined, cuerpo: () => void) => {
  const anterior = process.env[VARIABLE_SANDBOX]
  if (valor === undefined) delete process.env[VARIABLE_SANDBOX]
  else process.env[VARIABLE_SANDBOX] = valor
  try {
    cuerpo()
  } finally {
    if (anterior === undefined) delete process.env[VARIABLE_SANDBOX]
    else process.env[VARIABLE_SANDBOX] = anterior
  }
}

test.describe('Qué cuenta como destino local', () => {
  test('localhost, 127.0.0.1, ::1 y 0.0.0.0 con cualquier puerto', () => {
    for (const url of [
      'http://localhost:3000',
      'http://localhost:3010',
      'http://127.0.0.1:3010',
      'https://127.0.0.1',
      'http://[::1]:3010',
      'http://0.0.0.0:3010',
    ]) {
      expect(destinoEsLocal(url), url).toBe(true)
    }
  })

  test('cualquier dominio desplegado no lo es', () => {
    for (const url of [
      'https://agen.example.site',
      'https://staging.example.site',
      'http://192.168.1.20:3010',
      'https://example.com',
    ]) {
      expect(destinoEsLocal(url), url).toBe(false)
    }
  })

  test('un dominio que solo EMPIEZA por localhost no cuela', () => {
    // El fallo clásico de comprobar con startsWith/includes en vez de mirar el hostname.
    for (const url of ['https://localhost.example.com', 'https://127.0.0.1.example.com']) {
      expect(destinoEsLocal(url), url).toBe(false)
    }
  })

  test('una URL inválida no es local: ante la duda, no se escribe', () => {
    for (const url of ['', 'no-es-una-url', 'localhost:3010']) {
      expect(destinoEsLocal(url), url).toBe(false)
    }
  })
})

test.describe('Cuándo se permite escribir', () => {
  test('sin la variable del sandbox no se escribe, aunque el destino sea local', () => {
    conVariable(undefined, () => {
      const motivo = motivoParaNoEscribir('http://localhost:3010')
      expect(motivo).toContain(VARIABLE_SANDBOX)
    })
  })

  test('una variable en blanco cuenta como ausente', () => {
    conVariable('   ', () => {
      expect(motivoParaNoEscribir('http://localhost:3010')).toContain(VARIABLE_SANDBOX)
    })
  })

  test('con la variable puesta pero destino remoto tampoco se escribe', () => {
    conVariable('Estética Bella Vida', () => {
      const motivo = motivoParaNoEscribir('https://agen.example.site')
      expect(motivo).toContain('no es local')
    })
  })

  test('solo con las dos condiciones a la vez se permite', () => {
    conVariable('Estética Bella Vida', () => {
      expect(motivoParaNoEscribir('http://localhost:3010')).toBeNull()
    })
  })
})
