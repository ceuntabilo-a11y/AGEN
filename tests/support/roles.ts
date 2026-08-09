import path from 'node:path'

/**
 * Definición de los roles que usan las pruebas E2E.
 *
 * Ningún test escribe credenciales: cada rol declara los NOMBRES de las variables de
 * entorno que las contienen (`.env.test.local` en local, secrets en GitHub Actions) y la
 * ruta del `storageState` donde queda la sesión ya iniciada.
 *
 * Este módulo no lee `process.env` al importarse — solo dentro de las funciones — para que
 * `playwright.config.ts` pueda cargar el archivo de entorno antes de la primera lectura.
 */

export type E2ERoleId = 'platform' | 'admin' | 'professional' | 'client'

export interface E2ERole {
  /** Identificador del rol y nombre del project de Playwright. */
  id: E2ERoleId
  /** Nombre legible, para mensajes de error. */
  label: string
  /** Variable de entorno con el correo. */
  emailEnv: string
  /** Variable de entorno con la contraseña. */
  passwordEnv: string
  /** Archivo con la sesión guardada (ignorado por git). */
  storageState: string
  /** Carpeta donde viven las pruebas de este rol. */
  testDir: string
  /** Página a la que el rol debe llegar después de entrar. */
  home: string
}

/** Carpeta de sesiones guardadas. Está en .gitignore: contiene cookies reales. */
export const AUTH_DIR = path.resolve(__dirname, '..', '..', 'playwright', '.auth')

const role = (
  id: E2ERoleId,
  label: string,
  prefix: string,
  home: string,
): E2ERole => ({
  id,
  label,
  emailEnv: `E2E_${prefix}_EMAIL`,
  passwordEnv: `E2E_${prefix}_PASSWORD`,
  storageState: path.join(AUTH_DIR, `${id}.json`),
  testDir: path.resolve(__dirname, '..', 'e2e', id),
  home,
})

export const E2E_ROLES: E2ERole[] = [
  role('platform', 'Administrador de la plataforma', 'PLATFORM', '/plataforma'),
  role('admin', 'Dueño o administrador del negocio', 'ADMIN', '/admin'),
  role('professional', 'Profesional', 'PROFESSIONAL', '/profesional'),
  role('client', 'Cliente', 'CLIENT', '/cliente'),
]

export const getRole = (id: E2ERoleId): E2ERole => {
  const found = E2E_ROLES.find((item) => item.id === id)
  if (!found) throw new Error(`Rol E2E desconocido: ${id}`)
  return found
}

/** URL contra la que corren las pruebas. */
export const baseURL = (): string => process.env.E2E_BASE_URL || 'http://localhost:3000'

/** true si el rol tiene correo y contraseña configurados. */
export const roleIsConfigured = (item: E2ERole): boolean =>
  Boolean(process.env[item.emailEnv] && process.env[item.passwordEnv])

/**
 * Credenciales del rol. Falla con un mensaje claro si faltan — nunca hay valores por
 * defecto ni contraseñas escritas en el código.
 */
export const roleCredentials = (item: E2ERole): { email: string; password: string } => {
  const email = process.env[item.emailEnv]
  const password = process.env[item.passwordEnv]
  if (!email || !password) {
    throw new Error(
      `Faltan credenciales E2E de ${item.label}: define ${item.emailEnv} y ${item.passwordEnv} ` +
        'en .env.test.local (copia .env.test.example) o como secrets en GitHub Actions.',
    )
  }
  return { email, password }
}
