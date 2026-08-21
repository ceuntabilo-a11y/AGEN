import { normalizePhone } from '@/lib/phone'

/**
 * Piezas puras de la importación de clientes (Tanda 6): reconocer columnas, leer CSV a mano,
 * ordenar un nombre y decidir qué hacer con cada fila. Separado del componente y de la ruta de
 * la API para poder probarlo sin navegador y sin base de datos.
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

/** "Correo Electrónico" y "correo" son lo mismo para esto: sin tildes, minúscula, sin espacios de sobra. */
function normalizarEncabezado(valor: string): string {
  return String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Adivina qué columna es cada dato por el nombre de su título.
 *
 * Antes exigía que el encabezado fuera EXACTAMENTE uno de los alias ("correo", nada más) — un
 * archivo real con "Correo Electrónico" o "Notas Médicas / Tratamiento" no calzaba con nada y
 * esos datos se perdían en silencio, aunque para una persona sea obvio qué es cada columna.
 * Ahora basta con que el encabezado CONTENGA el alias (ambos sin tildes ni mayúsculas), que es
 * como escribe la gente de verdad sus planillas.
 */
export function autoMapear(headers: string[]): Record<string, number> {
  const normalizados = headers.map(normalizarEncabezado)
  const next: Record<string, number> = {}
  for (const [key, , aliases] of CAMPOS_IMPORTACION) {
    const aliasNormalizados = aliases.map(normalizarEncabezado)
    next[key] = normalizados.findIndex((encabezado) => aliasNormalizados.some((alias) => encabezado === alias || encabezado.includes(alias)))
  }
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

/** Lo mínimo de un cliente ya guardado que hace falta para decidir qué completarle. */
export type ClienteExistente = { id: string; phone: string | null; email: string | null; birthday: string | null; notes: string | null }

export type DecisionFila =
  | { accion: 'crear'; datos: { fullName: string; phone: string | null; email: string | null; birthday: string | null; notes: string | null } }
  | { accion: 'actualizar'; id: string; cambios: Record<string, unknown> }
  | { accion: 'omitir'; motivo: string }

/**
 * Qué hacer con una fila del archivo: crear un cliente nuevo, completar uno que ya existe, o
 * descartarla y por qué.
 *
 * Antes, una fila que coincidía en teléfono o correo con un cliente ya existente se descartaba
 * ENTERA — así que volver a subir el mismo archivo después de arreglar el mapeo de columnas no
 * servía de nada, porque los datos nuevos (correo, notas) nunca llegaban a guardarse. Ahora, si
 * hay coincidencia, se completan SOLO los campos que la ficha existente tenía vacíos: nunca se
 * pisa un dato real por uno que venga en el archivo, así el mismo archivo se puede volver a
 * subir las veces que haga falta sin arriesgar nada.
 */
export function decidirFila(
  fila: FilaImportada,
  existentePorTelefono: Map<string, ClienteExistente>,
  existentePorCorreo: Map<string, ClienteExistente>,
): DecisionFila {
  const fullName = fila.fullName.trim()
  if (!fullName) return { accion: 'omitir', motivo: 'Sin nombre' }

  const rawPhone = fila.phone.trim()
  const phone = rawPhone ? normalizePhone(rawPhone) : ''
  if (rawPhone && !phone) return { accion: 'omitir', motivo: `Teléfono inválido (${rawPhone})` }

  const email = fila.email.trim().toLowerCase() || null
  const birthday = fila.birthday.trim()
  if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return { accion: 'omitir', motivo: 'Fecha de nacimiento inválida (usa AAAA-MM-DD)' }
  const notes = fila.notes.trim().slice(0, 1000) || null

  const existente = (phone && existentePorTelefono.get(phone)) || (email && existentePorCorreo.get(email)) || null
  if (existente) {
    const cambios: Record<string, unknown> = {}
    if (email && !existente.email) cambios.email = email
    if (birthday && !existente.birthday) cambios.birthday = birthday
    if (notes && !existente.notes) cambios.notes = notes
    if (Object.keys(cambios).length === 0) return { accion: 'omitir', motivo: 'Ya existía, sin datos nuevos que agregar' }
    return { accion: 'actualizar', id: existente.id, cambios }
  }

  return { accion: 'crear', datos: { fullName: fullName.slice(0, 160), phone: phone || null, email, birthday: birthday || null, notes } }
}
