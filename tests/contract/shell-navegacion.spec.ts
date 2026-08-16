import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Regresión: pulsar «Agen» arriba a la izquierda sacaba al usuario de la aplicación.
 *
 * El logo enlazaba a `/`, que es la portada pública de venta. La sesión seguía viva, pero la
 * portada muestra «Iniciar sesión» arriba, así que para quien lo pulsaba era indistinguible de
 * haber sido expulsado — y desde ahí el único camino de vuelta era volver a entrar.
 *
 * Cerrar sesión tiene que ser SIEMPRE una acción explícita del menú de usuario, nunca el efecto
 * de pulsar un logo.
 */

const SHELL = readFileSync('src/components/DashboardShell.tsx', 'utf8')

test.describe('El logo de Agen navega, no expulsa', () => {
  test('el logo no enlaza a la portada pública', () => {
    expect(SHELL, 'el logo volvió a apuntar a "/", que saca al usuario de la aplicación').not.toMatch(/<Link href="\/"/)
  })

  test('lleva al panel del rol que está dentro', () => {
    // `items` es el menú del rol y su primera entrada es su inicio: /admin, /profesional,
    // /plataforma o /cliente. Así un rol nuevo no puede volver a caerse a la portada.
    expect(SHELL).toContain('<Link href={items[0][0]}')
  })

  test('el logo no cierra sesión por ningún camino', () => {
    const bloqueDelLogo = SHELL.slice(SHELL.indexOf('<Link href={items[0][0]}'), SHELL.indexOf('</Link>'))
    expect(bloqueDelLogo).not.toContain('signOut')
    expect(bloqueDelLogo).not.toContain('onClick')
  })

  test('cerrar sesión sigue viviendo solo en el menú de usuario', () => {
    const menu = readFileSync('src/components/AccountMenu.tsx', 'utf8')
    expect(menu).toContain('signOut')
  })
})
