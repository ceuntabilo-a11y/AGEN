'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  Bot,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ContactRound,
  Image,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Menu,
  Plug,
  Scissors,
  Settings,
  ListChecks,
  UsersRound,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { DatabaseStatusBanner } from '@/components/DatabaseStatusBanner'
import { formatInZone } from '@/lib/timezone'
import { NotificationBell } from '@/components/NotificationBell'
import { SessionTimeout } from '@/components/SessionTimeout'
import { InstallApp } from '@/components/InstallApp'
import { AccountMenu } from '@/components/AccountMenu'
import {Copilot} from '@/components/Copilot'

const adminItems = [
  ['/admin', 'Resumen', LayoutDashboard],
  ['/admin/agenda', 'Agenda', CalendarDays],
  ['/admin/equipo', 'Equipo', UsersRound],
  ['/admin/servicios', 'Servicios', Scissors],
  ['/admin/clientes', 'Clientes', ContactRound],
  ['/admin/seguimiento', 'Seguimiento', ListChecks],
  ['/admin/finanzas', 'Finanzas', CircleDollarSign],
  ['/admin/marketing', 'Marketing', Megaphone],
  ['/admin/galeria', 'Galería', Image],
  ['/admin/agente', 'Agente IA', Bot],
  ['/admin/integraciones', 'Integraciones', Plug],
  ['/admin/configuracion', 'Configuración', Settings],
] as const

const professionalItems = [
  ['/profesional', 'Mi día', LayoutDashboard],
  ['/profesional/agenda', 'Mi agenda', CalendarDays],
  ['/profesional/clientes', 'Mis clientes', ContactRound],
  ['/profesional/galeria', 'Mis trabajos', Image],
  ['/profesional/ingresos', 'Ingresos', CircleDollarSign],
  ['/profesional/perfil', 'Mi perfil', Settings],
] as const

const clientItems = [
  ['/cliente', 'Inicio', LayoutDashboard],
  ['/cliente/reservar', 'Reservar', CalendarDays],
  ['/cliente/reservas', 'Mis reservas', Scissors],
  ['/cliente/perfil', 'Mi perfil', Settings],
] as const

const platformItems = [
  ['/plataforma', 'Resumen', LayoutDashboard],
  ['/plataforma/negocios', 'Negocios', Building2],
  ['/plataforma/planes', 'Planes y complementos', CircleDollarSign],
  ['/plataforma/monitor', 'Monitor', Activity],
  ['/plataforma/claves', 'Claves de plataforma', KeyRound],
] as const

type Session = {
  name: string
  email?: string
  businessName: string
  timezone: string
}

export function DashboardShell({ children, role = 'admin' }: { children: React.ReactNode; role?: 'admin' | 'professional' | 'client' | 'platform' }) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const items = role === 'admin' ? adminItems : role === 'professional' ? professionalItems : role === 'platform' ? platformItems : clientItems

  useEffect(() => {
    fetch('/api/session').then((response) => response.ok ? response.json() : null).then(setSession).catch(() => {})
  }, [])

  async function logout() {
    sessionStorage.removeItem('agen_session_started')
    sessionStorage.removeItem('agen_session_closed')
    try { await createClient().auth.signOut() } catch {}
    router.replace('/login')
    router.refresh()
  }

  const initials = (session?.name ?? 'A').split(' ').map((value) => value[0]).slice(0, 2).join('').toUpperCase()
  const today = session?.timezone
    ? formatInZone(new Date(), session.timezone, { weekday: 'short', day: 'numeric', month: 'short' })
    : ''

  return <div className="min-h-screen bg-[#f5f4f9]">
    <button aria-label="Abrir menú" onClick={() => setOpen(true)} className="fixed left-4 top-4 z-30 rounded-xl bg-white p-2 shadow lg:hidden"><Menu size={22}/></button>
    {open && <button aria-label="Cerrar menú" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/30 lg:hidden"/>}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-[#19162b] p-4 text-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-7 flex items-center justify-between px-2 pt-2">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#6c4cff] text-xl font-black">A</span>
          <span><b className="block text-xl">Agen</b><small className="text-white/50">{session?.businessName ?? 'Tu negocio'}</small></span>
        </Link>
        <button aria-label="Cerrar menú" onClick={() => setOpen(false)} className="lg:hidden"><X/></button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map(([href, label, Icon]) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${pathname === href ? 'bg-[#6c4cff] text-white' : 'text-white/65 hover:bg-white/10 hover:text-white'}`}><Icon size={19}/>{label}</Link>)}
      </nav>
      <div className="border-t border-white/10 px-3 pt-3 text-xs leading-5 text-white/45">La sesión se protege automáticamente cuando el equipo queda sin uso.</div>
    </aside>
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-black/5 bg-white/80 px-5 pl-16 backdrop-blur lg:px-8">
        <div>
          <p className="text-sm text-[#736f83]">{role === 'admin' ? 'Panel administrador' : role === 'professional' ? 'Panel profesional' : role === 'platform' ? 'Panel de plataforma' : 'Mi cuenta'}</p>
          {today && <p className="hidden text-xs capitalize text-[#9a96a5] sm:block">{today}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right"><p className="text-sm font-bold">{session?.name ?? (role === 'client' ? 'Cliente' : role === 'professional' ? 'Profesional' : 'Administrador')}</p><p className="text-xs text-[#736f83]">{session?.businessName ?? 'Agen'}</p></div>
          {role!=='client'&&role!=='platform'&&<NotificationBell/>}
          <AccountMenu name={session?.name??'Usuario'} email={session?.email} role={role} initials={initials} onLogout={logout}/>
        </div>
      </header>
      <DatabaseStatusBanner/>
      <main className="p-5 lg:p-8">{children}</main>
    </div>
    <SessionTimeout/>
    <InstallApp/>
    {role==='admin'&&<Copilot/>}
  </div>
}
