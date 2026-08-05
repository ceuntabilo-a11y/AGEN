'use client'
import { PageHeader } from '@/components/PageHeader'
import { AvailabilityEditor } from '@/components/AvailabilityEditor'

export default function ProfessionalSchedulePage() {
  return <>
    <PageHeader title="Mi horario" description="Los días y horas en que el negocio puede reservarte clientes."/>
    <div className="max-w-2xl rounded-2xl border bg-white p-6"><AvailabilityEditor endpoint="/api/professional/availability"/></div>
  </>
}
