import { test, expect } from '@playwright/test'
import { CLAVES_SECRETAS, enmascarar, hayCambios, normalizarEntradas, vistaSegura } from '@/lib/platform-settings'

/**
 * Claves de plataforma.
 *
 * El bug que estas pruebas impiden que vuelva: el formulario mandaba `null` por cada campo que
 * el administrador dejaba en blanco, y `platform_settings.value` es `jsonb not null`. Rellenar
 * solo la clave de DashScope y dejar Evolution y Resend vacíos tumbaba el PATCH entero con una
 * violación de NOT NULL, y la pantalla decía "No se pudo guardar" sin más.
 *
 * La regla ahora, y es lo que se fija acá: ausente o `null` = no se toca · texto = se guarda ·
 * cadena vacía = se borra la fila. **Nunca se produce un `null` para escribir.**
 */

test.describe('Nunca se intenta escribir null', () => {
  test('el caso exacto del bug: solo DashScope, el resto vacío', () => {
    const entradas = normalizarEntradas({
      dashscope_fallback_key: 'sk-la-clave',
      openai_fallback_key: null,
      evolution_api_key: null,
      resend_api_key: null,
    })

    expect(entradas.guardar).toEqual([{ key: 'dashscope_fallback_key', value: 'sk-la-clave' }])
    expect(entradas.borrar).toEqual([])
    for (const item of entradas.guardar) expect(item.value).not.toBeNull()
  })

  test('un cuerpo entero de nulls no borra nada ni escribe nada', () => {
    const entradas = normalizarEntradas({ openai_fallback_key: null, resend_from: null })
    expect(entradas.guardar).toEqual([])
    expect(entradas.borrar).toEqual([])
    expect(hayCambios(entradas)).toBe(false)
  })

  test('una clave ausente del cuerpo no se toca', () => {
    const entradas = normalizarEntradas({ resend_from: 'Agen <hola@ejemplo.com>' })
    expect(entradas.guardar).toHaveLength(1)
    expect(entradas.borrar).toEqual([])
  })

  test('ningún valor a guardar puede ser vacío tras recortar', () => {
    const entradas = normalizarEntradas({ openai_fallback_key: '   ', dashscope_fallback_key: '  sk-x  ' })
    expect(entradas.borrar).toEqual(['openai_fallback_key'])
    expect(entradas.guardar).toEqual([{ key: 'dashscope_fallback_key', value: 'sk-x' }])
  })
})

test.describe('Quitar una clave borra la fila, no la deja en null', () => {
  test('la cadena vacía se traduce a borrar', () => {
    expect(normalizarEntradas({ evolution_api_key: '' }).borrar).toEqual(['evolution_api_key'])
  })

  test('se pueden guardar unas y quitar otras en la misma petición', () => {
    const entradas = normalizarEntradas({ dashscope_fallback_key: 'sk-nueva', resend_api_key: '' })
    expect(entradas.guardar).toEqual([{ key: 'dashscope_fallback_key', value: 'sk-nueva' }])
    expect(entradas.borrar).toEqual(['resend_api_key'])
    expect(hayCambios(entradas)).toBe(true)
  })
})

test.describe('Solo entran las claves conocidas', () => {
  test('lo que no está en la lista se ignora y se informa', () => {
    const entradas = normalizarEntradas({ dashscope_fallback_key: 'sk-x', borrar_todo: 'sí', __proto__: 'x' })
    expect(entradas.guardar).toEqual([{ key: 'dashscope_fallback_key', value: 'sk-x' }])
    expect(entradas.desconocidas).toContain('borrar_todo')
  })

  test('un cuerpo que no es un objeto no rompe nada', () => {
    for (const cuerpo of [null, undefined, 'texto', 42, ['a']]) {
      const entradas = normalizarEntradas(cuerpo)
      expect(hayCambios(entradas), String(cuerpo)).toBe(false)
    }
  })

  test('un número se guarda como texto (referral_percent viene así del formulario)', () => {
    expect(normalizarEntradas({ referral_percent: 15 }).guardar).toEqual([{ key: 'referral_percent', value: '15' }])
  })

  test('un texto larguísimo se recorta en vez de rechazarse', () => {
    const entradas = normalizarEntradas({ referral_terms: 'a'.repeat(5000) })
    expect(entradas.guardar[0].value.length).toBe(2000)
  })
})

test.describe('Una credencial guardada no vuelve al navegador', () => {
  const filas = [
    { key: 'dashscope_fallback_key', value: 'sk-proj-secretisima-1234' },
    { key: 'resend_from', value: 'Agen <hola@ejemplo.com>' },
  ]

  test('de las secretas solo se dice si están puestas y una pista', () => {
    const vista = vistaSegura(filas) as Record<string, { configurada: boolean; pista: string | null }>
    expect(vista.dashscope_fallback_key.configurada).toBe(true)
    expect(vista.dashscope_fallback_key.pista).toBe('••••1234')
    expect(JSON.stringify(vista)).not.toContain('secretisima')
  })

  test('ninguna secreta viaja en claro, mire donde se mire', () => {
    const serializado = JSON.stringify(vistaSegura(filas))
    for (const clave of CLAVES_SECRETAS) {
      const fila = filas.find((item) => item.key === clave)
      if (fila) expect(serializado).not.toContain(fila.value)
    }
    expect(serializado).not.toContain('sk-proj')
  })

  test('lo que no es credencial sí se muestra: hay que poder editarlo', () => {
    const vista = vistaSegura(filas) as Record<string, unknown>
    expect(vista.resend_from).toBe('Agen <hola@ejemplo.com>')
  })

  test('una secreta sin guardar dice que no está configurada', () => {
    const vista = vistaSegura([]) as Record<string, { configurada: boolean; pista: string | null }>
    expect(vista.openai_fallback_key).toEqual({ configurada: false, pista: null })
  })

  test('la pista nunca revela el largo ni el principio de la clave', () => {
    expect(enmascarar('sk-proj-abcdefghijklmnop')).toBe('••••mnop')
    expect(enmascarar('')).toBeNull()
    expect(enmascarar(null)).toBeNull()
    expect(enmascarar(12345)).toBeNull()
  })
})
