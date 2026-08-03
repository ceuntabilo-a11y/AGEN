'use client'
import { useCallback,useEffect,useRef,useState } from 'react'
import { createClient } from '@/lib/supabase'

const IDLE_MS=30*60*1000
const MAX_MS=12*60*60*1000
const WARNING_MS=2*60*1000
const EVENTS=['mousedown','keydown','scroll','touchstart','click'] as const

export function SessionTimeout({enabled=true}:{enabled?:boolean}){
  const last=useRef(Date.now()),started=useRef(Date.now())
  const [remaining,setRemaining]=useState<number|null>(null)
  const exit=useCallback(async(reason:'idle'|'maximum')=>{try{sessionStorage.setItem('agen_session_closed',reason);await createClient().auth.signOut()}finally{window.location.replace('/login')}},[])
  useEffect(()=>{
    if(!enabled)return
    const stored=Number(sessionStorage.getItem('agen_session_started')||0)
    started.current=stored||Date.now();if(!stored)sessionStorage.setItem('agen_session_started',String(started.current))
    const activity=()=>{last.current=Date.now();setRemaining(null)}
    EVENTS.forEach(name=>window.addEventListener(name,activity,{passive:true}))
    const timer=setInterval(()=>{const now=Date.now();if(now-started.current>=MAX_MS){void exit('maximum');return}const left=IDLE_MS-(now-last.current);if(left<=0){void exit('idle');return}setRemaining(left<=WARNING_MS?Math.ceil(left/1000):null)},1000)
    return()=>{EVENTS.forEach(name=>window.removeEventListener(name,activity));clearInterval(timer)}
  },[enabled,exit])
  if(remaining===null)return null
  const minutes=Math.floor(remaining/60),seconds=String(remaining%60).padStart(2,'0')
  return <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"><div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"><b className="text-3xl text-amber-600">{minutes}:{seconds}</b><h2 className="mt-2 text-lg font-extrabold">¿Sigues ahí?</h2><p className="mt-2 text-sm leading-6 text-[#736f83]">Por seguridad, la sesión se cerrará después de 30 minutos sin actividad.</p><button autoFocus onClick={()=>{last.current=Date.now();setRemaining(null)}} className="mt-5 w-full rounded-xl bg-[#5b3df5] py-3 font-bold text-white">Sigo aquí</button><button onClick={()=>void exit('idle')} className="mt-3 text-sm text-[#736f83]">Cerrar sesión ahora</button></div></div>
}
