/**
 * Contactos exportados como vCard (.vcf) — lo que entrega un celular o WhatsApp al exportar
 * contactos. Formato de texto simple, `CLAVE:valor` por línea, un `BEGIN:VCARD`/`END:VCARD`
 * por persona. No hace falta ninguna librería: es más simple que el propio CSV.
 */

export type FilaVCard = { fullName: string; phone: string; email: string; birthday: string; notes: string }

/** `19850604` o `1985-06-04` → `1985-06-04`. Cualquier otra cosa se descarta, no se adivina. */
function normalizarFecha(valor: string): string {
  const compacta = /^(\d{4})(\d{2})(\d{2})$/.exec(valor)
  if (compacta) return `${compacta[1]}-${compacta[2]}-${compacta[3]}`
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : ''
}

/** Une las líneas que el formato "pliega" con un espacio o tab al inicio de la siguiente. */
function desplegar(texto: string): string[] {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const resultado: string[] = []
  for (const linea of lineas) {
    if ((linea.startsWith(' ') || linea.startsWith('\t')) && resultado.length) resultado[resultado.length - 1] += linea.slice(1)
    else resultado.push(linea)
  }
  return resultado
}

export function parseVCard(texto: string): FilaVCard[] {
  const filas: FilaVCard[] = []
  let actual: FilaVCard | null = null
  for (const linea of desplegar(texto)) {
    if (/^BEGIN:VCARD/i.test(linea)) { actual = { fullName: '', phone: '', email: '', birthday: '', notes: '' }; continue }
    if (/^END:VCARD/i.test(linea)) { if (actual && (actual.fullName || actual.phone)) filas.push(actual); actual = null; continue }
    if (!actual) continue

    const corte = linea.indexOf(':')
    if (corte < 0) continue
    const clave = linea.slice(0, corte).split(';')[0].toUpperCase()
    const valor = linea.slice(corte + 1).replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim()
    if (!valor) continue

    if (clave === 'FN' && !actual.fullName) actual.fullName = valor
    else if (clave === 'N' && !actual.fullName) actual.fullName = valor.split(';').filter(Boolean).reverse().join(' ').trim()
    else if (clave === 'TEL' && !actual.phone) actual.phone = valor
    else if (clave === 'EMAIL' && !actual.email) actual.email = valor
    else if (clave === 'BDAY' && !actual.birthday) actual.birthday = normalizarFecha(valor)
    else if (clave === 'NOTE') actual.notes = [actual.notes, valor].filter(Boolean).join(' · ').slice(0, 1000)
  }
  return filas
}
