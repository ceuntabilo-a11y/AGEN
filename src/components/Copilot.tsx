'use client'
import Link from 'next/link'
import {Bot,Send,X} from 'lucide-react'
import {FormEvent,useState} from 'react'

type Reply={reply:string;href?:string;label?:string}
const suggestions=['¿Qué hay hoy?','¿Qué seguimientos tengo?','¿Cuánto ingresó hoy?']

export function Copilot(){
  const [open,setOpen]=useState(false),[question,setQuestion]=useState(''),[reply,setReply]=useState<Reply|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
  async function ask(value:string){setLoading(true);setError('');const response=await fetch('/api/admin/copilot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:value})});const data=await response.json();if(response.ok)setReply(data);else setError(data.error??'No se pudo consultar');setLoading(false)}
  function submit(event:FormEvent){event.preventDefault();if(question.trim())void ask(question.trim())}
  return <><button aria-label="Abrir copiloto" onClick={()=>setOpen(true)} className="fixed bottom-5 left-5 z-[70] grid h-12 w-12 place-items-center rounded-2xl bg-[#5b3df5] text-white shadow-xl lg:left-[276px]"><Bot/></button>{open&&<section className="fixed bottom-5 left-5 z-[90] w-[min(390px,calc(100vw-40px))] overflow-hidden rounded-3xl border bg-white shadow-2xl lg:left-[276px]"><header className="flex items-center justify-between bg-[#19162b] p-4 text-white"><div className="flex items-center gap-2"><Bot size={19}/><div><b className="text-sm">Copiloto Agen</b><p className="text-[11px] text-white/55">Solo lectura · datos reales</p></div></div><button aria-label="Cerrar" onClick={()=>setOpen(false)}><X size={18}/></button></header><div className="min-h-48 p-4">{reply?<><p className="text-sm leading-6">{reply.reply}</p>{reply.href&&<Link href={reply.href} onClick={()=>setOpen(false)} className="mt-4 inline-block rounded-xl bg-violet-50 px-4 py-2 text-sm font-bold text-[#5b3df5]">{reply.label}</Link>}</>:<><p className="text-sm text-[#736f83]">Pregunta por la operación del negocio.</p><div className="mt-3 flex flex-wrap gap-2">{suggestions.map(item=><button key={item} onClick={()=>void ask(item)} className="rounded-full border px-3 py-2 text-xs font-semibold">{item}</button>)}</div></>}{error&&<p className="mt-3 text-sm text-red-700">{error}</p>}</div><form onSubmit={submit} className="flex gap-2 border-t p-3"><input value={question} onChange={event=>setQuestion(event.target.value)} maxLength={300} placeholder="Pregunta sobre tu negocio" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"/><button disabled={loading||!question.trim()} className="grid h-10 w-10 place-items-center rounded-xl bg-[#5b3df5] text-white disabled:opacity-40"><Send size={16}/></button></form></section>}</>
}
