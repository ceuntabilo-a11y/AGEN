'use client'
import { useEffect, type ReactNode } from 'react'

/**
 * Capa común de todos los modales.
 *
 * Centraliza lo que antes faltaba en cada uno por separado: se anuncia como diálogo
 * (`role="dialog"` + `aria-modal`), tiene nombre accesible, y se cierra con Escape.
 * El contenido (formulario, panel, confirmación) lo pone cada modal.
 *
 * `onClose` debe ser estable o al menos no cambiar de identidad en cada render pesado;
 * el efecto se vuelve a suscribir si cambia, lo que es correcto pero innecesario.
 */
export function ModalShell({
  titulo,
  onClose,
  cerrarConEscape = true,
  className = 'fixed inset-0 z-50 grid place-items-center bg-black/40 p-4',
  children,
}: {
  titulo: string
  onClose: () => void
  /** Se apaga en los modales donde cerrar sin querer haría perder trabajo del usuario. */
  cerrarConEscape?: boolean
  className?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!cerrarConEscape) return
    const alPulsar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') onClose() }
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [cerrarConEscape, onClose])

  return <div role="dialog" aria-modal="true" aria-label={titulo} className={className}>{children}</div>
}
