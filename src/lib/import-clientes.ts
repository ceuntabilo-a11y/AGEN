/**
 * Piezas puras de la importación de clientes (Tanda 6): reconocer columnas, leer CSV a mano y
 * ordenar un nombre. Separado del componente para poder probarlo sin navegador.
 */

export type FilaImportada = { fullName: string; phone: string; email: string; birthday: string; notes: string }

export const CAMPOS_IMPORTACION: Array<[keyof FilaImportada, string, string[]]> = [
  ['fullName', 'Nombre', ['nombre', 'cliente', 'name', 'full_name', 'nombre completo', 'paciente']],
  ['phone', 'Teléfono', ['telefono', 'teléfono', 'celular', 'phone', 'movil', 'móvil', 'whatsapp', 'fono']],
  ['email', 'Correo', ['correo', 'email', 'mail', 'e-mail']],
  ['birthday', 'Nacimiento', ['nacimiento', 'cumpleanos', 'cumpleaños', 'birthday', 'fecha de nacimiento']],
  ['notes', 'Notas', ['notas', 'observaciones', 'comentarios', 'notes']],
]

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y'])

/** "JUAN perez  DE la torre" → "Juan Perez de la Torre". Solo capitalización: no adivina tildes que no estaban. */
export function ordenarNombre(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ').split(' ').map((palabra, indice) => {
    const baja = palabra.toLowerCase()
    if (indice > 0 && PARTICULAS.has(baja)) return baja
    return baja.charAt(0).toUpperCase() + baja.slice(1)
  }).join(' ')
}

/** Lector de CSV mínimo: respeta comillas y acepta coma o punto y coma como separador. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const separator = (clean.split('\n')[0].match(/;/g)?.length ?? 0) >= (clean.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < clean.length; index++) {
    const character = clean[index]
    if (quoted) {
      if (character === '"' && clean[index + 1] === '"') { value += '"'; index++ }
      else if (character === '"') quoted = false
      else value += character
    } else if (character === '"') quoted = true
    else if (character === separator) { row.push(value); value = '' }
    else if (character === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '' }
    else value += character
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row) }
  return rows.filter((line) => line.some((cell) => cell.trim()))
}

/** Una celda de Excel puede llegar como texto, número, fecha o booleano: todo se vuelve texto plano. */
export function celdaATexto(valor: unknown): string {
  if (valor == null) return ''
  if (valor instanceof Date) return valor.toISOString().slice(0, 10)
  return String(valor).trim()
}

/** Adivina qué columna es cada dato por el nombre de su título. */
export function autoMapear(headers: string[]): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [key, , aliases] of CAMPOS_IMPORTACION) next[key] = headers.findIndex((cell) => aliases.includes(cell.toLowerCase().trim()))
  return next
}

export function mapearFilas(raw: string[][], mapping: Record<string, number>): FilaImportada[] {
  return raw.slice(1).map((line) => ({
    fullName: mapping.fullName >= 0 ? ordenarNombre(line[mapping.fullName] ?? '') : '',
    phone: mapping.phone >= 0 ? (line[mapping.phone] ?? '').trim() : '',
    email: mapping.email >= 0 ? (line[mapping.email] ?? '').trim() : '',
    birthday: mapping.birthday >= 0 ? (line[mapping.birthday] ?? '').trim() : '',
    notes: mapping.notes >= 0 ? (line[mapping.notes] ?? '').trim() : '',
  }))
}
