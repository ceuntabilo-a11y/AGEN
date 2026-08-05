const STORAGE_KEY = 'agen_cuentas'
const MAX_ACCOUNTS = 6

export type CuentaRecordada = { email: string; name: string; role: string; lastUsed: number }

function leer(): CuentaRecordada[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function escribir(cuentas: CuentaRecordada[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cuentas.slice(0, MAX_ACCOUNTS))) } catch { /* localStorage no disponible */ }
}

export function cuentasRecordadas(): CuentaRecordada[] {
  return leer().sort((a, b) => b.lastUsed - a.lastUsed)
}

export function otrasCuentas(emailActual?: string | null): CuentaRecordada[] {
  const actual = emailActual?.toLowerCase()
  return cuentasRecordadas().filter((cuenta) => cuenta.email.toLowerCase() !== actual)
}

export function recordarCuenta(perfil: { email: string; name: string; role: string }) {
  const otras = leer().filter((cuenta) => cuenta.email.toLowerCase() !== perfil.email.toLowerCase())
  escribir([{ email: perfil.email, name: perfil.name, role: perfil.role, lastUsed: Date.now() }, ...otras])
}

export function olvidarCuenta(email: string) {
  escribir(leer().filter((cuenta) => cuenta.email.toLowerCase() !== email.toLowerCase()))
}
