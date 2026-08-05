'use client'

import { X } from 'lucide-react'
import { AvailabilityEditor } from '@/components/AvailabilityEditor'

export function AvailabilityModal({ professionalId, professionalName, onClose }: { professionalId: string; professionalName: string; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div>
          <h2 className="text-xl font-black">Horario de atención</h2>
          <p className="text-sm text-[#736f83]">{professionalName}</p>
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose}><X/></button>
      </div>
      <div className="mt-5"><AvailabilityEditor endpoint="/api/admin/availability" professionalId={professionalId}/></div>
    </div>
  </div>
}
