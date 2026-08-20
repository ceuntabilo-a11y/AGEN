import { test, expect } from '@playwright/test'
import { autoMapear, celdaATexto, mapearFilas, ordenarNombre, parseCsv } from '@/lib/import-clientes'
import { parseVCard } from '@/lib/vcard'

/**
 * Tanda 6: importar clientes desde Excel, Word, texto y contactos, no solo CSV. Estas son las
 * piezas que no dependen del navegador ni de una sesión: reconocer columnas, leer CSV a mano,
 * ordenar un nombre, convertir una celda de Excel y leer un .vcf de contactos exportados.
 */

test.describe('CSV: separador y comillas', () => {
  test('detecta coma o punto y coma según cuál predomina en la cabecera', () => {
    expect(parseCsv('Nombre,Teléfono\nAna,123')).toEqual([['Nombre', 'Teléfono'], ['Ana', '123']])
    expect(parseCsv('Nombre;Teléfono\nAna;123')).toEqual([['Nombre', 'Teléfono'], ['Ana', '123']])
  })

  test('respeta comas dentro de comillas', () => {
    expect(parseCsv('Nombre,Notas\nAna,"Vive en Santiago, cerca del metro"')).toEqual([
      ['Nombre', 'Notas'], ['Ana', 'Vive en Santiago, cerca del metro'],
    ])
  })

  test('descarta filas completamente vacías', () => {
    expect(parseCsv('Nombre,Telefono\nAna,123\n,\n')).toEqual([['Nombre', 'Telefono'], ['Ana', '123']])
  })
})

test.describe('Reconocer columnas por su título', () => {
  test('encuentra el nombre y el teléfono aunque el título tenga mayúsculas o tilde', () => {
    const mapping = autoMapear(['Nombre completo', 'Teléfono', 'Otra cosa'])
    expect(mapping.fullName).toBe(0)
    expect(mapping.phone).toBe(1)
    expect(mapping.email).toBe(-1)
  })

  test('una columna que no coincide con ningún alias no se mapea', () => {
    const mapping = autoMapear(['Columna rara'])
    expect(Object.values(mapping).every((indice) => indice === -1)).toBe(true)
  })
})

test.describe('Ordenar un nombre', () => {
  test('capitaliza sin inventar tildes', () => {
    expect(ordenarNombre('JUAN perez')).toBe('Juan Perez')
  })

  test('las partículas quedan en minúscula salvo al principio', () => {
    expect(ordenarNombre('maria DE LA torre')).toBe('Maria de la Torre')
  })

  test('espacios de más se limpian', () => {
    expect(ordenarNombre('  ana   pérez  ')).toBe('Ana Pérez')
  })
})

test.describe('Celda de Excel a texto', () => {
  test('una fecha se vuelve AAAA-MM-DD', () => {
    expect(celdaATexto(new Date('2026-05-04T00:00:00.000Z'))).toBe('2026-05-04')
  })

  test('un número y un vacío se leen como texto', () => {
    expect(celdaATexto(987654321)).toBe('987654321')
    expect(celdaATexto(null)).toBe('')
    expect(celdaATexto(undefined)).toBe('')
  })
})

test.describe('Mapear filas con la selección de columnas', () => {
  test('una columna sin elegir ("No importar") queda vacía', () => {
    const raw = [['Nombre', 'Telefono', 'Correo'], ['Ana Pérez', '+56911112222', 'ana@test.cl']]
    const filas = mapearFilas(raw, { fullName: 0, phone: 1, email: -1, birthday: -1, notes: -1 })
    expect(filas).toEqual([{ fullName: 'Ana Pérez', phone: '+56911112222', email: '', birthday: '', notes: '' }])
  })
})

test.describe('Contactos exportados (.vcf)', () => {
  test('lee nombre, teléfono, correo y cumpleaños de una tarjeta simple', () => {
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Ana Pérez',
      'TEL;TYPE=CELL:+56911112222',
      'EMAIL:ana@test.cl',
      'BDAY:19900504',
      'END:VCARD',
    ].join('\n')
    expect(parseVCard(vcf)).toEqual([{ fullName: 'Ana Pérez', phone: '+56911112222', email: 'ana@test.cl', birthday: '1990-05-04', notes: '' }])
  })

  test('varias tarjetas en el mismo archivo se leen todas', () => {
    const vcf = [
      'BEGIN:VCARD', 'FN:Ana Pérez', 'TEL:+56911112222', 'END:VCARD',
      'BEGIN:VCARD', 'FN:Pedro Soto', 'TEL:+56922223333', 'END:VCARD',
    ].join('\n')
    const filas = parseVCard(vcf)
    expect(filas.map((fila) => fila.fullName)).toEqual(['Ana Pérez', 'Pedro Soto'])
  })

  test('una tarjeta sin nombre ni teléfono se descarta', () => {
    const vcf = ['BEGIN:VCARD', 'NOTE:solo una nota suelta', 'END:VCARD'].join('\n')
    expect(parseVCard(vcf)).toHaveLength(0)
  })

  test('usa N cuando no hay FN, apellido primero como en la tarjeta', () => {
    const vcf = ['BEGIN:VCARD', 'N:Pérez;Ana;;;', 'TEL:+56911112222', 'END:VCARD'].join('\n')
    expect(parseVCard(vcf)[0].fullName).toBe('Ana Pérez')
  })

  test('una línea plegada (que sigue en la siguiente con un espacio) se une', () => {
    // El espacio al inicio de la segunda línea es el marcador de pliegue, no un espacio real:
    // se quita al desplegar, así que el que separa las palabras tiene que venir en la primera línea.
    const vcf = ['BEGIN:VCARD', 'FN:Ana Pérez', 'NOTE:primera parte y ', ' segunda parte', 'END:VCARD'].join('\n')
    expect(parseVCard(vcf)[0].notes).toBe('primera parte y segunda parte')
  })
})
