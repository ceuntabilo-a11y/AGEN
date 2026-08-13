#!/usr/bin/env node
/**
 * CLI del Approval Gateway. Ver `scripts/politica.mjs` para la política en sí.
 *
 * Solo lee y clasifica: nunca ejecuta la acción que se le pasa.
 *
 *   npm run gateway -- "git push"          clasifica una acción
 *   npm run gateway -- --auditar           comprueba que la política vigente sigue sana
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditar, clasificar, parsearPolitica } from './politica.mjs'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ARCHIVO_POLITICA = path.join(RAIZ, '.claude', 'settings.local.json')

const MARCA = { auto: 'AUTO     ', bloqueado: 'BLOQUEADO', humano: 'HUMANO   ' }

const argumentos = process.argv.slice(2)

// El archivo es local y no se versiona (CLAUDE.md §11): en un checkout limpio no está.
if (!existsSync(ARCHIVO_POLITICA)) {
  console.error('No encuentro .claude/settings.local.json.')
  console.error('Es un archivo local que no se versiona, así que en un checkout limpio no existe.')
  console.error('Sin él no hay política que consultar: créalo o copia el de otra máquina.')
  process.exit(2)
}

const politica = parsearPolitica(readFileSync(ARCHIVO_POLITICA, 'utf8'))

if (argumentos.includes('--auditar') || argumentos.length === 0) {
  const { ok, fallos } = auditar(politica)
  console.log(`Política: ${politica.allow.length} allow · ${politica.ask.length} ask · ${politica.deny.length} deny\n`)
  if (ok) {
    console.log('Auditoría correcta.')
    console.log('  · Todo lo irreversible sigue bloqueado.')
    console.log('  · Todo el trabajo normal sigue corriendo solo.')
  } else {
    console.log('AUDITORÍA FALLIDA — la política dejó de cumplir su propia definición:\n')
    for (const fallo of fallos) {
      console.log(`  ${fallo.accion}`)
      console.log(`      esperado: ${fallo.esperado}   obtenido: ${fallo.obtenido}`)
    }
    console.log('\nRevisa .claude/settings.local.json antes de seguir trabajando.')
    process.exitCode = 1
  }
} else {
  for (const accion of argumentos) {
    const { decision, motivo, regla } = clasificar(accion, { politica })
    console.log(`${MARCA[decision]} ${accion}`)
    console.log(`          ${motivo}`)
    if (regla) console.log(`          regla: ${regla}`)
  }
}
