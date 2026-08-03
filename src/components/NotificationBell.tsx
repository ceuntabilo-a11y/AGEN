'use client'
import { Bell,CheckCheck } from 'lucide-react'
import { useEffect,useRef,useState } from 'react'

type Notice={id:number;kind:string;title:string;body:string;read_at:string|null;created_at:string}

export function NotificationBell(){
  const [items,setItems]=useState<Notice[]>([]),[open,setOpen]=useState(false)
  const box=useRef<HTMLDivElement>(null)
  const load=()=>fetch('/api/notifications',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(d=>d&&setItems(d.notifications??[])).catch(()=>{})
  useEffect(()=>{load();const timer=setInterval(load,60000);return()=>clearInterval(timer)},[])
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(box.current&&!box.current.contains(event.target as Node))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[open])
  const unread=items.filter(item=>!item.read_at).length
  async function markAll(){await fetch('/api/notifications',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({all:true})});setItems(current=>current.map(item=>({...item,read_at:item.read_at??new Date().toISOString()})))}
  return <div ref={box} className="relative">
    <button aria-label="Notificaciones" onClick={()=>setOpen(value=>!value)} className="relative grid h-10 w-10 place-items-center rounded-full border bg-white text-[#5b3df5] hover:bg-violet-50"><Bell size={19}/>{unread>0&&<span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-5 text-white">{Math.min(unread,99)}</span>}</button>
    {open&&<div className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-2xl border bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b p-4"><b>Notificaciones</b><button onClick={markAll} disabled={!unread} className="inline-flex items-center gap-1 text-xs font-bold text-[#5b3df5] disabled:opacity-40"><CheckCheck size={15}/>Marcar leídas</button></div>
      <div className="max-h-96 overflow-y-auto">{items.map(item=><article key={item.id} className={`border-b p-4 ${item.read_at?'bg-white':'bg-violet-50'}`}><div className="flex items-start gap-2">{!item.read_at&&<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5b3df5]"/>}<div><b className="text-sm">{item.title}</b><p className="mt-1 text-xs leading-5 text-[#736f83]">{item.body}</p><time className="mt-1 block text-[10px] text-[#9a96a5]">{new Date(item.created_at).toLocaleString()}</time></div></div></article>)}{items.length===0&&<p className="p-8 text-center text-sm text-[#736f83]">No hay avisos nuevos.</p>}</div>
    </div>}
  </div>
}
