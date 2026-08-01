export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h1 className="text-2xl font-black tracking-tight text-[#19162b]">{title}</h1><p className="mt-1 text-sm text-[#736f83]">{description}</p></div>{action}</div>
}
