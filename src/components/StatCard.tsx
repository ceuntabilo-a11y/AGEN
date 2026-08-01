import type { LucideIcon } from 'lucide-react'
export function StatCard({ label, value, detail, icon: Icon, tone = '#5b3df5' }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: string }) {
  return <article className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-sm font-medium text-[#736f83]">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div><span className="grid h-11 w-11 place-items-center rounded-2xl" style={{ color: tone, backgroundColor: `${tone}16` }}><Icon size={22}/></span></div><p className="mt-3 text-xs text-[#736f83]">{detail}</p></article>
}
