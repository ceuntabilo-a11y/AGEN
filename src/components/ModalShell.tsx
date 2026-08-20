'use client'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

/**
 * Capa común de todos los modales.
 *
 * Centraliza lo que antes faltaba en cada uno por separado: se anuncia como diálogo
 * (`role="dialog"` + `aria-modal`), tiene nombre accesible, se cierra con Escape, y trae su
 * propia X para cerrar con el mouse — antes cada modal dependía de que el usuario supiera que
 * Escape funcionaba, o de encontrar el botón "Cancelar" correcto entre varios.
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

  return <div role="dialog" aria-modal="true" aria-label={titulo} className={className}>
    <div className="relative">
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar"
        className="absolute -right-3 -top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-black/10 bg-white text-[#4b4761] shadow-md hover:bg-[#f7f6fa]"
      >
        <X size={16} />
      </button>
    </div>
  </div>
}
