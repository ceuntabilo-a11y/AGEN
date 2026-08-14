#!/usr/bin/env node
/**
 * Sincroniza el preámbulo de las herramientas del agente.
 *
 * Las ocho herramientas del workflow 01 empiezan igual: leyendo los argumentos que manda el
 * modelo. Esa lectura ha fallado tres veces por formas distintas de entregar los argumentos
 * (ver `n8n-workflows/preambulo-herramientas.js`), y cada arreglo había que copiarlo ocho
 * veces a mano en un JSON de 40 000 caracteres — que es exactamente cómo se cuelan los
 * arreglos a medias.
 *
 * Ahora el preámbulo vive en UN archivo y esto lo inyecta:
 *
 *   npm run n8n -- herramientas            reescribe los nodos con el preámbulo actual
 *   npm run n8n -- herramientas --revisar  solo comprueba que están al día (código 1 si no)
 *
 * El corte entre preámbulo y cuerpo es la línea `const ctx = …`: todo lo anterior es el
 * preámbulo, todo lo posterior es lo propio de cada herramienta y no se toca.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(RAIZ, 'n8n-workflows', '01-agen-agent.json')
const PREAMBULO = path.join(RAIZ, 'n8n-workflows', 'preambulo-herramientas.js')
const CORTE = 'const ctx = '

/**
 * El preámbulo, siempre con saltos LF.
 *
 * En Windows el archivo llega del árbol de trabajo con CRLF, pero dentro del JSON del workflow
 * el código va con LF. Sin normalizar, la comparación decía que las ocho herramientas tenían
 * "su propia copia" cuando eran idénticas, y `herramientas` reescribía el workflow entero en
 * cada ejecución solo por los saltos de línea.
 */
export function preambulo() {
  return readFileSync(PREAMBULO, 'utf8').replace(/\r\n/g, '\n').trimEnd()
}

/** Devuelve el jsCode con el preámbulo actualizado, o `null` si el nodo no tiene el corte. */
export function conPreambulo(jsCode, texto = preambulo()) {
  const corte = jsCode.indexOf(CORTE)
  if (corte < 0) return null
  return `${texto}\n${jsCode.slice(corte)}`
}

export function herramientasDe(workflow) {
  return workflow.nodes.filter((nodo) => nodo.type === '@n8n/n8n-nodes-langchain.toolCode')
}

function principal() {
  const soloRevisar = process.argv.includes('--revisar')
  const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8'))
  const texto = preambulo()

  const desactualizadas = []
  for (const nodo of herramientasDe(workflow)) {
    const nuevo = conPreambulo(nodo.parameters.jsCode, texto)
    if (nuevo === null) {
      console.error(`La herramienta "${nodo.name}" no tiene la línea "${CORTE}…": no se puede separar el preámbulo.`)
      process.exit(2)
    }
    if (nuevo === nodo.parameters.jsCode) continue
    desactualizadas.push(nodo.name)
    nodo.parameters.jsCode = nuevo
  }

  if (soloRevisar) {
    if (desactualizadas.length) {
      console.error(`Herramientas con el preámbulo viejo: ${desactualizadas.join(', ')}`)
      console.error('Ejecuta: npm run n8n -- herramientas')
      process.exit(1)
    }
    console.log(`Las ${herramientasDe(workflow).length} herramientas están al día.`)
    return
  }

  if (!desactualizadas.length) { console.log('No había nada que actualizar.'); return }
  writeFileSync(WORKFLOW, `${JSON.stringify(workflow, null, 2)}\n`)
  console.log(`Actualizadas: ${desactualizadas.join(', ')}`)
  console.log('Ahora súbelo con: npm run n8n -- subir n8n-workflows/01-agen-agent.json')
}

// Solo actúa cuando se ejecuta como script; importarlo desde una prueba no toca nada.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal()
