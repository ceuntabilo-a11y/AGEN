import { test, expect } from '@playwright/test'
import { categoriaDePagina, nombreDePagina } from '../../src/lib/help-content'

/**
 * A qué categoría de la base de ayuda pertenece cada pantalla: es lo que le da al asistente
 * flotante (`Copilot.tsx` → `/api/admin/copilot`) contexto real de dónde está el dueño, sin
 * mandarle nada más que la URL.
 */

test.describe('categoriaDePagina', () => {
  test('reconoce cada pantalla del panel del dueño', () => {
    expect(categoriaDePagina('/admin/agenda')).toBe('Agenda')
    expect(categoriaDePagina('/admin/seguimiento')).toBe('Seguimiento')
    expect(categoriaDePagina('/admin/agente')).toBe('Agente IA')
    expect(categoriaDePagina('/admin/clientes')).toBe('Clientes')
  })

  test('reconoce una subpágina dinámica por su prefijo', () => {
    expect(categoriaDePagina('/admin/clientes/abc-123')).toBe('Clientes')
    expect(categoriaDePagina('/admin/marketing/nueva')).toBe('Marketing')
  })

  test('el Resumen y una ruta desconocida no tienen categoría', () => {
    expect(categoriaDePagina('/admin')).toBeNull()
    expect(categoriaDePagina('/admin/algo-que-no-existe')).toBeNull()
    expect(categoriaDePagina('')).toBeNull()
  })

  test('no confunde una categoría con el prefijo de otra', () => {
    // "/admin/agente" no debe calzar por error con "/admin/agenda" ni viceversa.
    expect(categoriaDePagina('/admin/agente')).not.toBe('Agenda')
    expect(categoriaDePagina('/admin/agenda')).not.toBe('Agente IA')
  })
})

test.describe('nombreDePagina', () => {
  test('el Resumen tiene un nombre amigable propio', () => {
    expect(nombreDePagina('/admin')).toBe('Resumen (panel principal)')
  })

  test('el resto usa el nombre de su categoría', () => {
    expect(nombreDePagina('/admin/finanzas')).toBe('Finanzas')
  })

  test('una ruta desconocida no rompe, cae a un texto genérico', () => {
    expect(nombreDePagina('/admin/algo-nuevo')).toBe('el panel de Agen')
  })
})
