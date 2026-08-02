export function normalizePhone(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[^0-9]/g, '')
}
