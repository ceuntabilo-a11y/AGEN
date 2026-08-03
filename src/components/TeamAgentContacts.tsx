'use client'

import {FormEvent,useEffect,useState} from 'react'
import {PhoneCall,Save} from 'lucide-react'

type Member={id:string;role:string;agent_phone:string|null;agent_display_name:string|null}
const labels:Record<string,string>={OWNER:'Propietario',ADMIN:'Administración',RECEPTIONIST:'Recepción'}

export function TeamAgentContacts(){
  const [members,setMembers]=useState<Member[]>([])
  const [message,setMessage]=useState('')
  useEffect(()=>{fetch('/api/admin/team-contacts').then(async response=>{if(!response.ok)throw new Error();return response.json()}).then(data=>setMembers((data.members??[]).filter((item:Member)=>item.role!=='PROFESSIONAL'))).catch(()=>setMembers([]))},[])
  async function save(event:FormEvent<HTMLFormElement>,memberId:string){
    event.preventDefault();setMessage('')
    const form=new FormData(event.currentTarget)
    const response=await fetch('/api/admin/team-contacts',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({memberId,displayName:form.get('displayName'),phone:form.get('phone')})})
    const data=await response.json()
    if(!response.ok){setMessage(data.error??'No se pudo guardar');return}
    setMembers(items=>items.map(item=>item.id===memberId?{...item,...data.member}:item));setMessage('Teléfono guardado')
  }
  if(!members.length)return null
  return <section className="mt-7 rounded-2xl border bg-white p-5">
    <div className="flex items-start gap-3"><PhoneCall className="mt-1 text-[#5b3df5]" size={20}/><div><h2 className="font-extrabold">Equipo reconocido por Agen</h2><p className="text-sm text-[#736f83]">Estos números reciben información en modo de solo lectura. Los profesionales configuran el suyo en Mi perfil.</p></div></div>
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{members.map(member=><form key={member.id} onSubmit={event=>save(event,member.id)} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-xs font-semibold">Nombre<input name="displayName" defaultValue={member.agent_display_name??''} placeholder={labels[member.role]??member.role} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal"/></label>
      <label className="text-xs font-semibold">Teléfono<input name="phone" type="tel" defaultValue={member.agent_phone??''} placeholder="+56 9 1234 5678" className="mt-1 w-full rounded-lg border p-2 text-sm font-normal"/></label>
      <button aria-label="Guardar" title="Guardar" className="grid h-10 w-10 place-items-center rounded-lg bg-[#5b3df5] text-white"><Save size={17}/></button>
    </form>)}</div>
    {message&&<p className="mt-3 text-sm font-semibold text-[#5b3df5]">{message}</p>}
  </section>
}
