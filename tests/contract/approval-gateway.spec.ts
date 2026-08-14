import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { NUNCA, SIEMPRE_AUTO, auditar, clasificar, coincide, parsearPolitica } from '../../scripts/politica.mjs'
import { contarBacklog, decidir } from '../../scripts/watchdog-logica.mjs'

/**
 * La política real de ESTA máquina.
 *
 * `.claude/settings.local.json` es local y no se versiona (CLAUDE.md §11), así que en CI no
 * existe. La auditoría de la política vigente solo tiene sentido donde vive el archivo: en el
 * equipo de quien trabaja, que es justo donde se puede romper editándolo.
 */
const ARCHIVO_VIGENTE = path.resolve(__dirname, '..', '..', '.claude', 'settings.local.json')
const politicaVigente = () => parsearPolitica(readFileSync(ARCHIVO_VIGENTE, 'utf8'))

/**
 * Approval Gateway y watchdog.
 *
 * El Gateway decide qué se ejecuta solo, qué se bloquea y qué necesita a una persona; el
 * watchdog decide si el trabajo está avanzando o se detuvo. Los dos son la diferencia entre
 * una automatización que corre sola y una que necesita a alguien mirando la pantalla, así que
 * su lógica va probada. Todo es función pura: sin git, sin red y sin reloj.
 */

const politica = {
  allow: ['Bash(git status*)', 'Bash(git push*)', 'Bash(npm run*)'],
  ask: ['Bash(npm install*)', 'Bash(git merge*)'],
  deny: ['Bash(git push --force*)', 'Bash(rm *)', 'Bash(*supabase.co*)'],
}

const decision = (comando: string) => clasificar(comando, { politica }).decision

test.describe('Las tres decisiones del Gateway', () => {
  test('lo normal, seguro y reversible se ejecuta solo', () => {
    for (const accion of ['git status --short', 'git push', 'npm run lint']) {
      expect(decision(accion), accion).toBe('auto')
    }
  })

  test('lo destructivo se bloquea, y no se pregunta', () => {
    for (const accion of ['rm -rf src', 'git push --force origin main']) {
      expect(decision(accion), accion).toBe('bloqueado')
    }
  })

  test('lo que ninguna herramienta resuelve sola pide una persona', () => {
    for (const accion of ['npm install zod', 'git merge main']) {
      expect(decision(accion), accion).toBe('humano')
    }
  })

  test('deny gana a allow aunque las dos reglas encajen', () => {
    // `git push` está en allow y `git push --force` en deny: manda el deny.
    expect(decision('git push --force')).toBe('bloqueado')
  })

  test('lo que no está en ninguna lista pide una persona, nunca se ejecuta', () => {
    for (const accion of ['terraform apply', 'curl https://algo.desconocido', 'ssh servidor']) {
      expect(decision(accion), accion).toBe('humano')
    }
  })

  test('una acción vacía no es "auto" por descarte', () => {
    expect(decision('')).toBe('humano')
    expect(decision('   ')).toBe('humano')
  })
})

test.describe('Un encadenado vale lo que su parte más restrictiva', () => {
  test('algo inocuo seguido de un borrado queda bloqueado', () => {
    for (const accion of ['git status && rm -rf build', 'npm run lint; rm x', 'git status | rm x']) {
      expect(decision(accion), accion).toBe('bloqueado')
    }
  })

  test('algo inocuo seguido de algo que pide aprobación, la pide', () => {
    expect(decision('git status && npm install zod')).toBe('humano')
  })

  test('si todas las partes son seguras, se ejecuta solo', () => {
    expect(decision('npm run lint && npm run typecheck && git push')).toBe('auto')
  })

  test('bloqueado gana a humano dentro del mismo encadenado', () => {
    expect(decision('npm install zod && rm -rf src')).toBe('bloqueado')
  })
})

test.describe('El comodín se comporta como en el archivo de permisos', () => {
  test('`*` cubre cualquier cosa, incluidos espacios y saltos', () => {
    expect(coincide('Bash(git push*)', 'Bash', 'git push --set-upstream origin x')).toBe(true)
    expect(coincide('Bash(*supabase.co*)', 'Bash', 'curl https://abc.supabase.co/rest')).toBe(true)
  })

  test('la regla tiene que cubrir el comando ENTERO, no solo el principio', () => {
    expect(coincide('Bash(git status)', 'Bash', 'git status --short')).toBe(false)
  })

  test('una regla de otra herramienta no aplica', () => {
    expect(coincide('Bash(rm *)', 'Write', 'rm -rf src')).toBe(false)
  })
})

test.describe('La política vigente de esta máquina se audita sola', () => {
  test('lo irreversible sigue bloqueado y el trabajo normal sigue corriendo solo', () => {
    test.skip(!existsSync(ARCHIVO_VIGENTE), 'No hay .claude/settings.local.json: es un archivo local y en CI no existe.')
    const { ok, fallos } = auditar(politicaVigente())
    expect(fallos, JSON.stringify(fallos, null, 1)).toEqual([])
    expect(ok).toBe(true)
  })

  test('las dos listas de la auditoría no están vacías: una auditoría vacía siempre pasa', () => {
    expect(NUNCA.length).toBeGreaterThan(5)
    expect(SIEMPRE_AUTO.length).toBeGreaterThan(5)
  })
})

test.describe('El watchdog sabe cuándo hay trabajo y cuándo no queda nada', () => {
  const limpio = {
    head: 'a'.repeat(40), sucio: 0, sinEmpujar: 0,
    ci: { id: '1', estado: 'completed', conclusion: 'success' },
    backlog: { hechos: 11, pendientes: 0, bloqueados: 0, total: 11 },
  }

  test('todo verde y backlog cerrado: TERMINADO', () => {
    expect(decidir(limpio, null).veredicto).toBe('TERMINADO')
    expect(decidir(limpio, null).codigoSalida).toBe(0)
  })

  test('el CI corriendo se espera, y avisa de por qué no hay que empujar encima', () => {
    const salida = decidir({ ...limpio, ci: { id: '7', estado: 'in_progress', conclusion: null } }, null)
    expect(salida.veredicto).toBe('ESPERANDO')
    expect(salida.motivo).toContain('cancela')
    expect(salida.siguienteComando).toContain('gh run watch 7')
  })

  test('el CI rojo se arregla antes que cualquier otra cosa', () => {
    const salida = decidir({
      ...limpio,
      ci: { id: '9', estado: 'completed', conclusion: 'failure' },
      backlog: { hechos: 0, pendientes: 5, bloqueados: 0, total: 5 },
    }, null)
    expect(salida.veredicto).toBe('HAY_TRABAJO')
    expect(salida.siguienteComando).toContain('--log-failed')
  })

  test('trabajo local a medias: primero se termina y se sube', () => {
    expect(decidir({ ...limpio, sucio: 3 }, null).veredicto).toBe('HAY_TRABAJO')
    expect(decidir({ ...limpio, sinEmpujar: 2 }, null).veredicto).toBe('HAY_TRABAJO')
  })

  test('con el backlog abierto no se declara terminado', () => {
    const salida = decidir({ ...limpio, backlog: { hechos: 8, pendientes: 3, bloqueados: 0, total: 11 } }, null)
    expect(salida.veredicto).toBe('HAY_TRABAJO')
    expect(salida.motivo).toContain('3')
  })

  test('si solo quedan puntos esperando al dueño, avisa en vez de dar vueltas', () => {
    const salida = decidir({ ...limpio, backlog: { hechos: 8, pendientes: 0, bloqueados: 3, total: 11 } }, null)
    expect(salida.veredicto).toBe('INTERVENCION_HUMANA')
    expect(salida.codigoSalida).toBe(30)
  })
})

test.describe('El watchdog detecta que el trabajo se detuvo', () => {
  const conTrabajo = {
    head: 'b'.repeat(40), sucio: 2, sinEmpujar: 0, ci: { id: '1', estado: 'completed', conclusion: 'success' },
    backlog: { hechos: 5, pendientes: 4, bloqueados: 0, total: 9 },
  }

  test('el mismo estado dos veces seguidas es ATASCADO, no "hay trabajo" otra vez', () => {
    const primera = decidir(conTrabajo, null)
    expect(primera.veredicto).toBe('HAY_TRABAJO')

    const segunda = decidir(conTrabajo, { huella: primera.huella })
    expect(segunda.veredicto).toBe('ATASCADO')
    expect(segunda.codigoSalida).toBe(40)
  })

  test('si algo se movió, no está atascado aunque quede trabajo', () => {
    const primera = decidir(conTrabajo, null)
    const despues = decidir({ ...conTrabajo, sucio: 0, head: 'c'.repeat(40) }, { huella: primera.huella })
    expect(despues.veredicto).toBe('HAY_TRABAJO')
  })

  test('parado con backlog pendiente y nada que commitear también es ATASCADO', () => {
    const parado = { ...conTrabajo, sucio: 0, sinEmpujar: 0 }
    const primera = decidir(parado, null)
    expect(decidir(parado, { huella: primera.huella }).veredicto).toBe('ATASCADO')
  })

  test('terminado sigue siendo terminado aunque no se mueva nada', () => {
    const fin = {
      head: 'd'.repeat(40), sucio: 0, sinEmpujar: 0,
      ci: { id: '1', estado: 'completed', conclusion: 'success' },
      backlog: { hechos: 11, pendientes: 0, bloqueados: 0, total: 11 },
    }
    const primera = decidir(fin, null)
    expect(decidir(fin, { huella: primera.huella }).veredicto).toBe('TERMINADO')
  })
})

test.describe('El backlog se lee del propio HANDOFF', () => {
  const markdown = `
# Estado

## Backlog maestro — estado real

- [x] 1. Hecho
- [ ] 2. Pendiente
- [!] 3. Esperando al dueño
- [x] 4. Otro hecho

## Riesgos abiertos

- [ ] esto no cuenta: está fuera de la sección
`

  test('cuenta hechos, pendientes y bloqueados', () => {
    expect(contarBacklog(markdown)).toEqual({ hechos: 2, pendientes: 1, bloqueados: 1, total: 4 })
  })

  test('no cuenta las marcas de otras secciones', () => {
    expect(contarBacklog(markdown).total).toBe(4)
  })

  test('sin la sección no inventa un backlog', () => {
    expect(contarBacklog('# Nada')).toEqual({ hechos: 0, pendientes: 0, bloqueados: 0, total: 0 })
  })
})
