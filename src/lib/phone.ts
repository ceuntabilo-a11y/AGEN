export function normalizePhone(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[^0-9]/g, '')
}

/**
 * Un teléfono real de cliente, no un identificador de WhatsApp.
 *
 * Los grupos de WhatsApp llegan con un JID de 18 dígitos (`120363…@g.us`) y, si no se filtra,
 * el agente terminaba creando "clientes" y respondiendo dentro de grupos ajenos al negocio.
 * E.164 permite 15 dígitos como máximo, así que cualquier cosa más larga no es un teléfono.
 */
export function isRealClientPhone(value: unknown) {
  const phone = normalizePhone(value)
  return phone.length >= 8 && phone.length <= 15
}
