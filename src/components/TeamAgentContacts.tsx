'use client'
import { ModalShell } from '@/components/ModalShell'

import {FormEvent,useEffect,useState} from 'react'
import {PhoneCall,Save,Trash2,X} from 'lucide-react'

type Member={id:string;role:string;agent_phone:string|null;agent_display_name:string|null}
const labels:Record<string,string>={OWNER:'Propietario',ADMIN:'Administración',RECEPTIONIST:'Recepción'}
const displayName=(member:Member)=>member.agent_display_name||labels[member.role]||member.role
const sameName=(a:string,b:string)=>a.trim().toLowerCase()===b.trim().toLowerCase()

export function TeamAgentContacts(){
  const [members,setMembers]=useState<Member[]>([])
  const [message,setMessage]=useState('')
  const [removing,setRemoving]=useState<Member|null>(null)
  const [confirmText,setConfirmText]=useState('')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{fetch('/api/admin/team-contacts').then(async response=>{if(!response.ok)throw new Error();return response.json()}).then(data=>setMembers((data.members??[]).filter((item:Member)=>item.role!=='PROFESSIONAL'))).catch(()=>setMembers([]))},[])
  async function save(event:FormEvent<HTMLFormElement>,memberId:string){
    event.preventDefault();setMessage('')
    const form=new FormData(event.currentTarget)
    const response=await fetch('/api/admin/team-contacts',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({memberId,displayName:form.get('displayName'),phone:form.get('phone')})})
    const data=await response.json()
    if(!response.ok){setMessage(data.error??'No se pudo guardar');return}
    setMembers(items=>items.map(item=>item.id===memberId?{...item,...data.member}:item));setMessage('Teléfono guardado')
  }
  async function remove(){
    if(!removing)return
    setBusy(true);setMessage('')
    const response=await fetch('/api/admin/team-contacts',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({memberId:removing.id})})
    const data=await response.json()
    setBusy(false)
    if(!response.ok){setMessage(data.error??'No se pudo eliminar');return}
    setMembers(items=>items.map(item=>item.id===removing.id?{...item,...data.member}:item))
    setRemoving(null);setConfirmText('');setMessage('Miembro eliminado del reconocimiento del agente')
  }
  if(!members.length)return null
  return <section className="mt-7 rounded-2xl border bg-white p-5">
    <div className="flex items-start gap-3"><PhoneCall className="mt-1 text-[#5b3df5]" size={20}/><div><h2 className="font-extrabold">Equipo reconocido por Agen</h2><p className="text-sm text-[#736f83]">Estos números reciben información en modo de solo lectura. Los profesionales configuran el suyo en Mi perfil.</p></div></div>
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{members.map(member=><form key={member.id} onSubmit={event=>save(event,member.id)} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      <label className="text-xs font-semibold">Nombre<input name="displayName" defaultValue={member.agent_display_name??''} placeholder={labels[member.role]??member.role} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal"/></label>
      <label className="text-xs font-semibold">Teléfono<input name="phone" type="tel" defaultValue={member.agent_phone??''} placeholder="+56 9 1234 5678" className="mt-1 w-full rounded-lg border p-2 text-sm font-normal"/></label>
      <button aria-label="Guardar" title="Guardar" className="grid h-10 w-10 place-items-center rounded-lg bg-[#5b3df5] text-white"><Save size={17}/></button>
      {(member.agent_phone||member.agent_display_name)?<button type="button" aria-label="Eliminar" title="Eliminar" onClick={()=>{setRemoving(member);setConfirmText('')}} className="grid h-10 w-10 place-items-center rounded-lg border text-red-600"><Trash2 size={17}/></button>:<span className="h-10 w-10"/>}
    </form>)}</div>
    {message&&<p className="mt-3 text-sm font-semibold text-[#5b3df5]">{message}</p>}
    {removing&&<ModalShell titulo="Eliminar miembro reconocido" onClose={()=>setRemoving(null)}><div className="w-full max-w-md rounded-3xl bg-white p-6">
      <div className="flex justify-between"><h3 className="text-lg font-black">Eliminar miembro reconocido</h3><button type="button" onClick={()=>setRemoving(null)}><X size={18}/></button></div>
      <p className="mt-3 text-sm leading-6 text-[#736f83]">Se quitará el teléfono y el nombre de <b>{displayName(removing)}</b> del reconocimiento del agente. Escribe <b>{displayName(removing)}</b> para confirmar el borrado.</p>
      <input autoFocus value={confirmText} onChange={event=>setConfirmText(event.target.value)} className="mt-4 w-full rounded-xl border p-3 text-sm" placeholder={displayName(removing)}/>
      <div className="mt-4 flex gap-2">
        <button disabled={busy||!sameName(confirmText,displayName(removing))} onClick={()=>void remove()} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy?'Eliminando…':'Eliminar definitivamente'}</button>
        <button type="button" onClick={()=>setRemoving(null)} className="flex-1 rounded-xl border py-2.5 text-sm font-semibold">Cancelar</button>
      </div>
    </div></ModalShell>}
  </section>
}
