import { test, expect } from '@playwright/test'
import { COMMIT_DESCONOCIDO, cuerpoDeSalud, versionDelBuild } from '@/lib/version'

/**
 * Versión desplegada.
 *
 * Lo que estas pruebas impiden que vuelva: `/api/health` respondía `{ok:true}` sin más, así
 * que "el arreglo está en main" y "el arreglo está vivo en producción" eran indistinguibles
 * desde fuera. El despliegue es un clic manual, de modo que esa diferencia es real y se ha
 * dado: código mergeado y producción sirviendo la versión anterior sin que nada lo dijera.
 *
 * Y la otra mitad, igual de importante: que este campo no se convierta en una filtración.
 * Solo puede salir un SHA público y una fecha. Nada más.
 */

const SHA = '4a2f9c1e0b7d3a5f6e8c9d0a1b2c3d4e5f607182'

test.describe('El commit vivo se puede comparar con main', () => {
  test('el SHA del build llega entero y también en corto', () => {
    const version = versionDelBuild({ AGEN_COMMIT: SHA })
    expect(version.commit).toBe(SHA)
    expect(version.commitCorto).toBe('4a2f9c1')
  })

  test('sin dato responde "desconocido", nunca un valor inventado', () => {
    const version = versionDelBuild({})
    expect(version.commit).toBe(COMMIT_DESCONOCIDO)
    expect(version.commitCorto).toBe(COMMIT_DESCONOCIDO)
    expect(version.compiladoEn).toBeNull()
  })

  test('un valor que no es un SHA se descarta en vez de propagarse', () => {
    // Si alguien exporta AGEN_COMMIT="refs/heads/main" o deja una plantilla sin sustituir, el
    // dato es basura: mejor decir "desconocido" que hacer creer que se está comparando algo.
    for (const basura of ['refs/heads/main', '$GITHUB_SHA', 'zzzzzzz', '123', '', '   ']) {
      expect(versionDelBuild({ AGEN_COMMIT: basura }).commit).toBe(COMMIT_DESCONOCIDO)
    }
  })

  test('el SHA se normaliza a minúsculas para que la comparación con main no falle por eso', () => {
    expect(versionDelBuild({ AGEN_COMMIT: SHA.toUpperCase() }).commit).toBe(SHA)
  })

  test('una fecha de compilación inválida no se propaga', () => {
    expect(versionDelBuild({ AGEN_COMPILADO: 'ayer' }).compiladoEn).toBeNull()
    const buena = '2026-08-14T10:00:00.000Z'
    expect(versionDelBuild({ AGEN_COMPILADO: buena }).compiladoEn).toBe(buena)
  })
})

test.describe('El cuerpo de /api/health', () => {
  const entorno = { AGEN_COMMIT: SHA, AGEN_COMPILADO: '2026-08-14T10:00:00.000Z' }

  test('conserva lo que ya consumía la monitorización', () => {
    // `monitor-salud.mjs` exige ok===true y service==='agen' para no confundir esta app con
    // otra que responda 200 en el mismo puerto. Romper eso rompe la vigilancia 24/7.
    const cuerpo = cuerpoDeSalud(entorno, new Date('2026-08-14T12:00:00.000Z'))
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.service).toBe('agen')
    expect(cuerpo.timestamp).toBe('2026-08-14T12:00:00.000Z')
  })

  test('no expone ningún campo más que los siete acordados', () => {
    const cuerpo = cuerpoDeSalud(entorno)
    expect(Object.keys(cuerpo).sort()).toEqual(
      ['commit', 'commitCorto', 'huella', 'compiladoEn', 'ok', 'service', 'timestamp'].sort(),
    )
  })

  test('la huella sobrevive aunque el commit no se pueda resolver', () => {
    // Es el caso real de EasyPanel: sin `.git` ni SHA en el entorno, la huella es el ÚNICO
    // dato con el que se puede saber si lo desplegado es lo que hay en main.
    const soloHuella = cuerpoDeSalud({ AGEN_HUELLA: '5235c41433dbc129' })
    expect(soloHuella.commit).toBe(COMMIT_DESCONOCIDO)
    expect(soloHuella.huella).toBe('5235c41433dbc129')
  })

  test('una huella con mala forma se descarta en vez de propagarse', () => {
    for (const basura of ['', 'no-es-una-huella', '5235c414', `${'a'.repeat(17)}`]) {
      expect(cuerpoDeSalud({ AGEN_HUELLA: basura }).huella).toBe('desconocida')
    }
  })

  test('no filtra ninguna variable de entorno sensible', () => {
    const conSecretos = {
      ...entorno,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secretísima',
      OPENAI_API_KEY: 'sk-secreta',
      AGEN_WEBHOOK_SECRET: 'secreto-compartido',
      EVOLUTION_API_KEY: 'evolution-secreta',
    }
    const serializado = JSON.stringify(cuerpoDeSalud(conSecretos))
    for (const secreto of ['service-role-secretísima', 'sk-secreta', 'secreto-compartido', 'evolution-secreta']) {
      expect(serializado).not.toContain(secreto)
    }
  })

  test('el timestamp es el de la petición, no el del build', () => {
    const a = cuerpoDeSalud(entorno, new Date('2026-08-14T12:00:00.000Z'))
    const b = cuerpoDeSalud(entorno, new Date('2026-08-14T12:00:01.000Z'))
    expect(a.timestamp).not.toBe(b.timestamp)
    expect(a.compiladoEn).toBe(b.compiladoEn)
  })
})
