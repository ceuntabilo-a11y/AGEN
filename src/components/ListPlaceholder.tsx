import type { ReactNode } from 'react'

/**
 * Mensaje que ocupa el lugar de una lista vacía.
 *
 * Existe para no confundir "todavía estoy cargando" con "no hay nada": mientras la consulta
 * no termina se muestra "Cargando…", y el texto de lista vacía recién aparece cuando ya se
 * sabe que la respuesta llegó y vino sin datos. Si la carga falló, la página muestra su
 * propio aviso de error y acá no se dibuja nada.
 */
export function ListPlaceholder({
  loading,
  error = false,
  className = 'p-8 text-center text-sm text-[#736f83]',
  children,
}: {
  loading: boolean
  error?: boolean
  className?: string
  children: ReactNode
}) {
  if (error) return null
  return <p className={className}>{loading ? 'Cargando…' : children}</p>
}
