'use client'
import Link from 'next/link'
import {LogOut,Settings,UserRound,Repeat,X as XIcon} from 'lucide-react'
import {useEffect,useRef,useState} from 'react'
import {createClient} from '@/lib/supabase'
import {otrasCuentas,olvidarCuenta,type CuentaRecordada} from '@/lib/accounts'

const ROLE_LABEL:Record<string,string>={OWNER:'Dueño',ADMIN:'Administrador',RECEPTIONIST:'Recepción',PROFESSIONAL:'Profesional',CLIENT:'Cliente',PLATFORM_ADMIN:'Plataforma'}

export function AccountMenu({name,email,role,initials,onLogout}:{name:string;email?:string;role:'admin'|'professional'|'client'|'platform';initials:string;onLogout:()=>void}){
  const [open,setOpen]=useState(false),[vista,setVista]=useState<'menu'|'cuentas'>('menu'),[confirming,setConfirming]=useState(false),[otras,setOtras]=useState<CuentaRecordada[]>([]),box=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(box.current&&!box.current.contains(event.target as Node))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[open])
  useEffect(()=>{if(open)setOtras(otrasCuentas(email))},[open,email])
  const href=role==='admin'?'/admin/configuracion':role==='client'?'/cliente/perfil':role==='platform'?'/plataforma/claves':'/profesional/perfil'
  async function cambiarA(cuentaEmail?:string){
    try{await createClient().auth.signOut()}catch{}
    window.location.href=cuentaEmail?`/login?email=${encodeURIComponent(cuentaEmail)}`:'/login'
  }
  return <div ref={box} className="relative"><button aria-label="Menú de usuario" aria-expanded={open} onClick={()=>{setOpen(value=>!value);setConfirming(false);setVista('menu')}} className="grid h-10 w-10 place-items-center rounded-full bg-violet-100 text-sm font-bold text-[#5b3df5] ring-offset-2 focus:ring-2">{initials}</button>{open&&<div className="absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-2xl border bg-white shadow-2xl"><div className="border-b p-4"><b className="block truncate text-sm">{name}</b><span className="block truncate text-xs text-[#736f83]">{email}</span></div>
    {vista==='menu'&&!confirming&&<div className="p-2">
      <Link href={href} onClick={()=>setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-[#f6f4ff]">{role==='client'?<UserRound size={17}/>:<Settings size={17}/>} {role==='admin'?'Configuración':'Mi perfil'}</Link>
      <button onClick={()=>setVista('cuentas')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-[#f6f4ff]"><Repeat size={17}/>Cambiar cuenta{otras.length>0&&<span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-[#5b3df5]">{otras.length}</span>}</button>
      <button onClick={()=>setConfirming(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"><LogOut size={17}/>Cerrar sesión</button>
    </div>}
    {vista==='cuentas'&&<div className="max-h-80 overflow-y-auto p-2">
      <button onClick={()=>setVista('menu')} className="mb-1 px-3 py-1 text-xs font-bold text-[#736f83]">← Volver</button>
      {otras.length===0&&<p className="px-3 py-2 text-xs text-[#736f83]">No hay otras cuentas usadas en este equipo todavía.</p>}
      {otras.map((cuenta)=><div key={cuenta.email} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-[#f6f4ff]">
        <button onClick={()=>cambiarA(cuenta.email)} className="flex flex-1 items-center gap-3 text-left"><span className="grid h-9 w-9 place-items-center rounded-full bg-violet-100 text-xs font-bold text-[#5b3df5]">{cuenta.name.split(' ').map(v=>v[0]).slice(0,2).join('').toUpperCase()}</span><span className="min-w-0"><b className="block truncate text-sm">{cuenta.name}</b><span className="block truncate text-xs text-[#736f83]">{ROLE_LABEL[cuenta.role]??cuenta.role} · {cuenta.email}</span></span></button>
        <button aria-label={`Olvidar ${cuenta.email}`} onClick={()=>{olvidarCuenta(cuenta.email);setOtras(otrasCuentas(email))}} className="rounded-lg p-1.5 text-[#a29dae] hover:bg-red-50 hover:text-red-600"><XIcon size={14}/></button>
      </div>)}
      <button onClick={()=>cambiarA()} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#5b3df5] hover:bg-[#f6f4ff]"><UserRound size={17}/>Entrar con otra cuenta</button>
      <p className="px-3 pt-2 text-xs text-[#736f83]">Vas a tener que escribir la contraseña de esa cuenta — por seguridad, este equipo no la guarda.</p>
    </div>}
    {confirming&&<div className="p-4"><b className="text-sm">¿Cerrar sesión?</b><p className="mt-1 text-xs text-[#736f83]">Tendrás que escribir nuevamente tu contraseña.</p><div className="mt-4 flex gap-2"><button onClick={()=>setConfirming(false)} className="flex-1 rounded-xl border py-2 text-sm font-bold">Cancelar</button><button onClick={onLogout} className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-bold text-white">Sí, salir</button></div></div>}
  </div>}</div>
}
