import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { E2E_ROLES, baseURL, roleIsConfigured } from './tests/support/roles';

/**
 * Credenciales de las pruebas E2E.
 *
 * Se leen de `.env.test.local` (ignorado por git, plantilla en `.env.test.example`) con la
 * API nativa `process.loadEnvFile()` — sin dotenv ni ninguna dependencia extra.
 * Node no pisa variables que ya existan en el entorno, así que en GitHub Actions mandan
 * los secrets del repositorio. Si el archivo no existe, no se falla acá: cada test avisa
 * qué variable le falta cuando la necesita (ver `roleCredentials` en tests/support/roles.ts).
 */
const ENV_FILE = path.resolve(__dirname, '.env.test.local');
if (existsSync(ENV_FILE)) {
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error(
      `Node ${process.version} no tiene process.loadEnvFile(). Usa Node 22 (ver .nvmrc) ` +
        'o ejecuta las pruebas con: node --env-file=.env.test.local node_modules/@playwright/test/cli.js test',
    );
  }
  process.loadEnvFile(ENV_FILE);
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /*
   * Dos workers en local. Con más, `next dev` recompila varias rutas a la vez y las esperas
   * por datos se vuelven impredecibles: los fallos que produce son del servidor de desarrollo,
   * no de la app. Contra un build de producción se puede subir sin problema.
   */
  workers: process.env.CI ? 1 : 2,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* En `npm run dev` la primera compilación de cada página tarda varios segundos. */
  timeout: 120000,
  expect: { timeout: 30000 },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: baseURL(),

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /*
   * Solo hay projects reales de AGEN. Los genéricos chromium/firefox/webkit existían
   * únicamente para el spec de ejemplo del scaffold, que probaba playwright.dev y no esta
   * app. El cross-browser y el responsive se añadirán con pruebas propias.
   */
  projects: [
    /*
     * Inicio de sesión por rol (tests/e2e/auth.setup.ts): entra una sola vez por rol y guarda
     * la sesión en playwright/.auth/<rol>.json. Reutilizarla evita el bloqueo por intentos de
     * /api/auth/login (5 fallidos por correo en 15 minutos).
     */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },

    /*
     * Un project por rol, cada uno con su propia sesión guardada.
     * Solo se registran los roles que tienen credenciales. En un checkout sin
     * `.env.test.local` ni secrets no queda ningún project de rol y el `setup` falla
     * diciendo qué variable falta, en vez de intentar un login imposible.
     */
    ...E2E_ROLES.filter(roleIsConfigured).map((role) => ({
      name: role.id,
      testDir: role.testDir,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: role.storageState },
    })),

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /*
   * En CI la suite levanta ella misma el build de producción (`npm start`, puerto 3010) y
   * espera a que /api/health responda. En local no se toca nada: se usa el servidor que ya
   * tengas corriendo, según E2E_BASE_URL.
   */
  webServer: process.env.CI
    ? {
        command: 'npm start',
        url: 'http://localhost:3010/api/health',
        reuseExistingServer: false,
        timeout: 120000,
      }
    : undefined,
});
