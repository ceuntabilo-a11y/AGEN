import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { plantillaInvitacion } from '@/lib/platform-invitations'
import { CLAVES_PLATAFORMA, vistaSegura } from '@/lib/platform-settings'

/**
 * El camino por el que entra el dueño de un negocio: invitación → correo → activar → contraseña
 * → su panel. Lo que se fija acá es lo que no puede fallar sin que el cliente se quede fuera.
 */

const INVITACIONES = readFileSync('src/lib/platform-invitations.ts', 'utf8')
const CLAVES_UI = readFileSync('src/app/plataforma/claves/page.tsx', 'utf8')

test.describe('El enlace de activación funciona en cualquier navegador', () => {
  /*
   * El fallo que cerraba: `action_link` acaba en `/auth/callback?code=…`, y canjear ese código
   * exige el «code verifier» que guarda el navegador que INICIÓ el flujo. Acá lo inicia el
   * servidor al crear el negocio, así que el navegador del invitado —otro equipo, días después—
   * nunca lo tuvo: el canje falla y la persona aterriza en el login sin poder hacer nada.
   */
  test('el correo lleva a /auth/confirm con token_hash, no al canje por código', () => {
    expect(INVITACIONES).toContain('/auth/confirm?token_hash=')
    expect(INVITACIONES).toContain('type=invite')
    // Y el redirect que se le pide a Supabase tampoco vuelve al canje por código.
    expect(INVITACIONES).not.toContain('/auth/callback`')
  })

  test('el destino tras activar lleva el nombre del negocio', () => {
    expect(INVITACIONES).toContain('/auth/set-password?negocio=')
  })

  test('la pantalla de activación dice a qué negocio se entra', () => {
    const pantalla = readFileSync('src/app/auth/set-password/page.tsx', 'utf8')
    expect(pantalla).toContain('Activa tu cuenta para')
    expect(pantalla).toContain("parametros.get('negocio')")
    // Y un enlace ya usado o caducado se explica, en vez de soltar el error de Supabase.
    expect(pantalla).toContain('ya no es válido')
  })

  test('la verificación ocurre en el servidor', () => {
    const confirmar = readFileSync('src/app/auth/confirm/route.ts', 'utf8')
    expect(confirmar).toContain('verifyOtp')
    expect(confirmar).toContain('token_hash')
  })
})

test.describe('El correo de invitación', () => {
  const HTML = plantillaInvitacion({
    negocio: 'Estética Bella Vida',
    enlace: 'https://agen.synetia.site/auth/confirm?token_hash=abc&type=invite',
    diasDeVigencia: 7,
  })

  test('sale como transaccional, no por el camino de marketing', () => {
    // El envío de marketing reescribe el remitente visible con el nombre del negocio, y un
    // nombre que no cuadra con el dominio que firma es una señal de spam clásica.
    expect(INVITACIONES).toContain('sendTransactionalEmail')
    expect(INVITACIONES).not.toContain('sendMarketingEmail')
  })

  test('el asunto dice qué hacer y de qué negocio', () => {
    expect(INVITACIONES).toContain('Activa tu acceso a ${datos.negocio} en Agen')
  })

  test('nunca lleva una contraseña', () => {
    expect(HTML).not.toMatch(/contraseña\s*[:=]\s*\S/i)
    expect(HTML).not.toMatch(/\bpassword\b\s*[:=]/i)
    expect(HTML).toContain('Nadie de Agen te va a pedir tu contraseña')
  })

  test('explica negocio, acción y caducidad', () => {
    expect(HTML).toContain('Estética Bella Vida')
    expect(HTML).toContain('Activar mi acceso')
    expect(HTML).toContain('caduca en 7 días')
  })

  test('el nombre del negocio no puede inyectar HTML', () => {
    const sucio = plantillaInvitacion({ negocio: '<script>alert(1)</script>', enlace: 'https://x.test', diasDeVigencia: 7 })
    expect(sucio).not.toContain('<script>')
    expect(sucio).toContain('&lt;script&gt;')
  })

  test('no depende de imágenes ni de JavaScript, que el correo bloquea', () => {
    expect(HTML).not.toMatch(/<img\b/i)
    expect(HTML).not.toMatch(/<script\b/i)
  })
})

test.describe('La URL de n8n se puede configurar de verdad', () => {
  /*
   * Estaba aceptada por el servidor y la leía el health check, pero el formulario nunca la
   * pintó: el Monitor decía «sin configurar» y no existía ningún sitio donde configurarla.
   */
  test('la clave existe en el servidor', () => {
    expect(CLAVES_PLATAFORMA).toContain('n8n_api_url')
  })

  test('y tiene su campo en la pantalla de claves', () => {
    expect(CLAVES_UI).toContain("clave: 'n8n_api_url'")
    expect(CLAVES_UI).toContain('n8n-agen.synetia.site')
  })

  test('no es una credencial: vuelve al navegador en claro para poder editarla', () => {
    const vista = vistaSegura([{ key: 'n8n_api_url', value: 'https://n8n-agen.synetia.site' }])
    expect(vista.n8n_api_url).toBe('https://n8n-agen.synetia.site')
  })

  test('toda clave del servidor tiene dónde escribirse', () => {
    // Esta es la prueba que habría evitado el fallo: una clave sin campo es una clave imposible
    // de configurar, y el aviso que provoca no tiene arreglo desde la interfaz.
    // Las de referidos viven en su propia pantalla, no en esta.
    for (const clave of CLAVES_PLATAFORMA.filter((nombre) => !nombre.startsWith('referral_'))) {
      expect(CLAVES_UI, `la clave "${clave}" no tiene campo en /plataforma/claves`).toContain(`clave: '${clave}'`)
    }
  })
})

test.describe('Nunca se crean dos cuentas para el mismo correo', () => {
  test('si el correo ya existe se reutiliza esa cuenta', () => {
    expect(INVITACIONES).toContain('email_exists')
    expect(INVITACIONES).toContain('listUsers')
  })

  test('y entonces no se manda ninguna invitación: ya tiene su contraseña', () => {
    const reenviar = readFileSync('src/app/api/platform/businesses/[id]/invite/route.ts', 'utf8')
    expect(reenviar).toContain('cuentaExistente: true')
  })
})
