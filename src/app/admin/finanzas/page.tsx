'use client'

import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { NewQuoteModal } from '@/components/NewQuoteModal'
import { money } from '@/lib/money'
import { CircleDollarSign, HandCoins, PackageOpen, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'

type Data = { sales:number; directCosts:number; commissions:number; operatingExpenses:number; net:number; quotes:Array<any>; currency:string }

export default function FinancePage() {
  const [data,setData] = useState<Data>({ sales:0,directCosts:0,commissions:0,operatingExpenses:0,net:0,quotes:[],currency:'CLP' })
  const [error,setError] = useState(false)
  const [show,setShow] = useState(false)
  const load = () => fetch('/api/admin/finance').then(async (response) => {
    if (!response.ok) throw new Error()
    return response.json()
  }).then((value) => { setData(value); setError(false) }).catch(() => setError(true))

  useEffect(() => { load() }, [])

  return <>
    {show && <NewQuoteModal onClose={() => setShow(false)} onCreated={load}/>}
    <PageHeader title="Finanzas" description="Ventas, costos, anticipos, comisiones y rentabilidad real." action={<button onClick={() => setShow(true)} className="rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white">Nuevo presupuesto</button>}/>
    {error && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Conecta Supabase para ver cifras reales. No se muestran valores ficticios.</p>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Ventas del mes" value={money(data.sales,data.currency)} detail="Pagos confirmados" icon={CircleDollarSign}/>
      <StatCard label="Costos directos" value={money(data.directCosts,data.currency)} detail="Materiales de servicios completados" icon={PackageOpen} tone="#ff9f43"/>
      <StatCard label="Comisiones" value={money(data.commissions,data.currency)} detail="Calculadas por profesional" icon={HandCoins} tone="#ff6f91"/>
      <StatCard label="Resultado neto" value={money(data.net,data.currency)} detail={`Gastos operativos: ${money(data.operatingExpenses,data.currency)}`} icon={TrendingUp} tone="#17b890"/>
    </section>
    <section className="mt-6 rounded-2xl border bg-white p-5">
      <h2 className="font-extrabold">Presupuestos recientes</h2>
      <div className="mt-4 space-y-3">
        {data.quotes.map((quote) => <div key={quote.id} className="flex items-center justify-between rounded-xl bg-[#f7f6fa] p-3">
          <div><b className="block text-sm">{quote.client?.full_name ?? 'Cliente'}</b><small className="text-[#736f83]">{quote.quote_items?.map((item:any) => item.description).join(', ')}</small></div>
          <div className="text-right"><b className="block text-sm">{money(Number(quote.total),data.currency)}</b><small className="text-[#5b3df5]">{quote.status}</small></div>
        </div>)}
        {!error && data.quotes.length === 0 && <p className="py-6 text-center text-sm text-[#736f83]">Aún no hay presupuestos.</p>}
      </div>
    </section>
  </>
}
