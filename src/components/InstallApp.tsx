'use client'
import { Download,Share2,X } from 'lucide-react'
import { useEffect,useState } from 'react'

type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>}

export function InstallApp(){
  const [prompt,setPrompt]=useState<InstallPrompt|null>(null),[visible,setVisible]=useState(false),[ios,setIos]=useState(false)
  useEffect(()=>{if(window.matchMedia('(display-mode: standalone)').matches||localStorage.getItem('agen_install_hidden'))return;const handler=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);setVisible(true)};window.addEventListener('beforeinstallprompt',handler);const apple=/iphone|ipad|ipod/i.test(navigator.userAgent);if(apple){setIos(true);setVisible(true)}return()=>window.removeEventListener('beforeinstallprompt',handler)},[])
  if(!visible)return null
  async function install(){if(!prompt)return;await prompt.prompt();await prompt.userChoice;setVisible(false)}
  function close(){localStorage.setItem('agen_install_hidden','1');setVisible(false)}
  return <div className="fixed bottom-4 right-4 z-[80] w-[min(420px,calc(100vw-32px))] rounded-2xl border bg-white p-4 shadow-2xl"><button aria-label="Cerrar" onClick={close} className="absolute right-3 top-3 text-[#736f83]"><X size={17}/></button><div className="flex gap-3">{ios?<Share2 className="shrink-0 text-[#5b3df5]"/>:<Download className="shrink-0 text-[#5b3df5]"/>}<div><b className="text-sm">Instala Agen como aplicación</b><p className="mt-1 pr-4 text-xs leading-5 text-[#736f83]">{ios?'En Safari pulsa Compartir y luego “Añadir a pantalla de inicio”.':'Funciona en móvil, tableta y computador sin descargarla desde una tienda.'}</p></div></div>{!ios&&<button onClick={()=>void install()} className="mt-3 w-full rounded-xl bg-[#5b3df5] py-2.5 text-sm font-bold text-white">Instalar Agen</button>}</div>
}
