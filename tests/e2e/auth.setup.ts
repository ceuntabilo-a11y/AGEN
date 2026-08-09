import { mkdirSync } from 'node:fs'
import { test as setup, expect } from '@playwright/test'
import { AUTH_DIR, E2E_ROLES, roleCredentials } from '../support/roles'

/**
 * Inicia sesión una sola vez por rol y guarda la sesión en playwright/.auth/<rol>.json.
 *
 * Las credenciales salen siempre de variables de entorno (.env.test.local en local,
 * secrets en CI): nunca se escriben acá ni se imprimen. Los mensajes de error mencionan
 * el NOMBRE de la variable, jamás su valor.
 *
 * En serie a propósito: /api/auth/login bloquea 15 minutos tras 5 intentos fallidos por
 * correo (y 20 por IP), así que no conviene disparar cuatro logins a la vez.
 */
setup.describe.configure({ mode: 'serial' })

for (const role of E2E_ROLES) {
  setup(`autenticar ${role.id} (${role.label})`, async ({ page }) => {
    // Lanza un error claro y sin secretos si falta alguna variable.
    const { email, password } = roleCredentials(role)

    mkdirSync(AUTH_DIR, { recursive: true })

    await page.goto('/login')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').fill(password)
    await page.getByRole('button', { name: 'Entrar' }).click()

    // El formulario redirige según el rol que devuelve /api/session. El margen es amplio
    // porque en `npm run dev` la primera compilación del panel puede tardar bastante.
    try {
      await page.waitForURL((url) => url.pathname.startsWith(role.home), { timeout: 60000 })
    } catch {
      const shown = await page
        .locator('p.bg-red-50')
        .first()
        .textContent()
        .catch(() => null)
      const actual = new URL(page.url()).pathname
      throw new Error(
        `No se pudo iniciar sesión como ${role.label}. ` +
          `Esperaba llegar a ${role.home} y quedó en ${actual}. ` +
          `Revisa ${role.emailEnv} y ${role.passwordEnv} en .env.test.local, y que ese ` +
          `usuario exista con el rol correcto.` +
          (shown ? ` La app respondió: "${shown.trim()}".` : ''),
      )
    }

    // La sesión tiene que sobrevivir a middleware.ts: si no, volvería a /login.
    await page.goto(role.home)
    await expect(page, `middleware.ts no aceptó la sesión de ${role.label}`).toHaveURL(
      new RegExp(`${role.home}(?:[/?#]|$)`),
    )

    await page.context().storageState({ path: role.storageState })
  })
}
