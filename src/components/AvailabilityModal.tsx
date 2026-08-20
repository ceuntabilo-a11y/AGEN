'use client'

import { AvailabilityEditor } from '@/components/AvailabilityEditor'
import { ModalShell } from '@/components/ModalShell'

export function AvailabilityModal({ professionalId, professionalName, onClose }: { professionalId: string; professionalName: string; onClose: () => void }) {
  return <ModalShell titulo="Horario de atención" onClose={onClose}>
    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-6">
      <div className="flex justify-between">
        <div>
          <h2 className="text-xl font-black">Horario de atención</h2>
          <p className="text-sm text-[#736f83]">{professionalName}</p>
        </div>
      </div>
      <div className="mt-5"><AvailabilityEditor endpoint="/api/admin/availability" professionalId={professionalId}/></div>
    </div>
  </ModalShell>
}
