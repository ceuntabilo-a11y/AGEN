import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  AVISO_VENCIMIENTO_DIAS, diasRestantes, estadoDeNegocio,
  slugDesdeNombre, slugValido, vencimientoDesdeDuracion,
} from '@/lib/platform-business'
import { plantillaInvitacion } from '@/lib/platform-invitations'

/**
 * Las reglas comerciales de la plataforma: cómo se llama un negocio en la URL, cuánto dura y en
 * qué estado está hoy. Son las que deciden lo que el dueño de Agen ve en su panel, así que un
 * fallo acá no rompe una pantalla: le hace tomar una decisión de venta con datos falsos.
 */

test.describe('La dirección web se genera sola desde el nombre', () => {
  test('quita acentos, mayúsculas y signos', () => {
    expect(slugDesdeNombre('Estética Bella Vida')).toBe('estetica-bella-vida')
    expect(slugDesdeNombre('Barbería “El Corte” #1')).toBe('barberia-el-corte-1')
    expect(slugDesdeNombre('  Spa   Ñuñoa  ')).toBe('spa-nunoa')
  })

  test('nunca deja guiones sueltos en los extremos', () => {
    for (const nombre of ['—Spa—', '...Salón...', '  ¡Hola!  ']) {
      const slug = slugDesdeNombre(nombre)
      expect(slug.startsWith('-'), nombre).toBe(false)
      expect(slug.endsWith('-'), nombre).toBe(false)
    }
  })

  test('lo que genera siempre es válido', () => {
    for (const nombre of ['Estética Bella Vida', 'Barbería 24/7', 'Ñandú Spa & Co.']) {
      expect(slugValido(slugDesdeNombre(nombre)), nombre).toBe(true)
    }
  })

  test('rechaza lo que la base rechazaría', () => {
    for (const malo of ['', 'a', 'Mayúsculas', 'con espacio', '-empieza', 'termina-', 'doble--guion', 'acentué']) {
      expect(slugValido(malo), malo).toBe(false)
    }
  })
})

test.describe('La vigencia se cuenta como la cuenta quien vende', () => {
  test('el último día está incluido: 7 días desde el 1 vencen el 7', () => {
    expect(vencimientoDesdeDuracion('2026-08-01', 7)).toBe('2026-08-07')
    expect(vencimientoDesdeDuracion('2026-08-01', 1)).toBe('2026-08-01')
    expect(vencimientoDesdeDuracion('2026-08-01', 30)).toBe('2026-08-30')
  })

  test('cruza meses y años sin equivocarse', () => {
    expect(vencimientoDesdeDuracion('2026-08-28', 7)).toBe('2026-09-03')
    expect(vencimientoDesdeDuracion('2026-12-28', 15)).toBe('2027-01-11')
  })

  test('sin duración no hay vencimiento', () => {
    expect(vencimientoDesdeDuracion('2026-08-01', null)).toBeNull()
    expect(vencimientoDesdeDuracion('2026-08-01', 0)).toBeNull()
  })

  test('los días restantes cuentan hoy como día vivo', () => {
    expect(diasRestantes('2026-08-20', '2026-08-17')).toBe(3)
    expect(diasRestantes('2026-08-17', '2026-08-17')).toBe(0)
    expect(diasRestantes('2026-08-16', '2026-08-17')).toBe(-1)
    expect(diasRestantes(null, '2026-08-17')).toBeNull()
  })
})

test.describe('El estado del negocio se calcula, no se guarda', () => {
  const HOY = '2026-08-17'

  test('suspendido gana sobre todo lo demás', () => {
    expect(estadoDeNegocio({ active: true, suspended_at: '2026-08-01', is_demo: true, expires_on: '2026-12-01' }, HOY)).toBe('SUSPENDIDO')
  })

  test('apagado va antes que vencido', () => {
    expect(estadoDeNegocio({ active: false, suspended_at: null, expires_on: '2026-01-01' }, HOY)).toBe('INACTIVO')
  })

  test('una demo caducada es VENCIDO, no DEMO', () => {
    // El día siguiente al vencimiento ya no es demo activa: es justo lo que hay que ir a cobrar.
    expect(estadoDeNegocio({ active: true, suspended_at: null, is_demo: true, expires_on: '2026-08-16' }, HOY)).toBe('VENCIDO')
    expect(estadoDeNegocio({ active: true, suspended_at: null, is_demo: true, expires_on: '2026-08-17' }, HOY)).toBe('DEMO')
  })

  test('un cliente sin vencimiento está siempre activo', () => {
    expect(estadoDeNegocio({ active: true, suspended_at: null, is_demo: false, expires_on: null }, HOY)).toBe('ACTIVO')
  })

  test('el aviso de vencimiento mira una semana por delante', () => {
    expect(AVISO_VENCIMIENTO_DIAS).toBe(7)
  })
})

/*
 * El correo de invitación es lo primero que ve un cliente nuevo de Agen. Lo que se prueba acá no
 * es que se vea bonito —eso se mira— sino lo que no puede fallar nunca: que no lleve una
 * contraseña y que no se pueda inyectar HTML desde el nombre del negocio.
 */
test.describe('El correo de invitación', () => {
  const HTML = plantillaInvitacion({ negocio: 'Estética Bella Vida', enlace: 'https://agen.synetia.site/x?token=abc', diasDeVigencia: 7 })

  test('nunca lleva una contraseña', () => {
    expect(HTML).not.toMatch(/contraseña\s*[:=]\s*\S/i)
    expect(HTML).not.toMatch(/\bpassword\b\s*[:=]/i)
    expect(HTML).toContain('Nadie de Agen te va a pedir tu contraseña')
  })

  test('explica quién invita, a qué negocio y qué hacer', () => {
    expect(HTML).toContain('Estética Bella Vida')
    expect(HTML).toContain('Activar mi acceso')
    expect(HTML).toContain('https://agen.synetia.site/x?token=abc')
    expect(HTML).toContain('caduca en 7 días')
  })

  test('el nombre del negocio no puede inyectar HTML', () => {
    const sucio = plantillaInvitacion({ negocio: '<script>alert(1)</script>', enlace: 'https://x.test', diasDeVigencia: 7 })
    expect(sucio).not.toContain('<script>')
    expect(sucio).toContain('&lt;script&gt;')
  })

  test('no depende de imágenes externas, que el correo bloquea por defecto', () => {
    expect(HTML).not.toMatch(/<img\b/i)
  })
})

test.describe('La migración de plataforma es segura de aplicar', () => {
  const SQL = readFileSync('supabase/migrations/20260817000001_platform_lifecycle.sql', 'utf8')

  test('es aditiva: no borra ni reescribe nada', () => {
    expect(SQL).not.toMatch(/\bdrop\s+table\b/i)
    expect(SQL).not.toMatch(/\bdrop\s+column\b/i)
    expect(SQL).not.toMatch(/\btruncate\b/i)
    expect(SQL).not.toMatch(/\bdelete\s+from\b/i)
  })

  test('se puede volver a ejecutar sin romperse', () => {
    for (const guarda of ['add column if not exists', 'create table if not exists', 'create index if not exists']) {
      expect(SQL.toLowerCase(), guarda).toContain(guarda)
    }
  })

  test('los negocios que ya existen no cambian de conducta', () => {
    // is_demo por defecto false y expires_on nulo: siguen siendo clientes sin vencimiento.
    expect(SQL).toMatch(/is_demo boolean not null default false/i)
    expect(SQL).toContain('business_invitations')
    expect(SQL).toMatch(/enable row level security/i)
  })
})
