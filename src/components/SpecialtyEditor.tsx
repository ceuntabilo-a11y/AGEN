'use client'
import { FormEvent, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
type Specialty={id:string;name:string;slug:string;color:string}
export function SpecialtyEditor({onChanged}:{onChanged:()=>void}){
  const [items,setItems]=useState<Specialty[]>([])
  const [editing,setEditing]=useState<Specialty|null>(null)
  const [name,setName]=useState('')
  const [color,setColor]=useState('#64748b')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const load=()=>fetch('/api/admin/catalog').then(r=>r.json()).then(d=>setItems(d.specialties??[]))
  useEffect(()=>{void load()},[])
  function startEdit(specialty:Specialty){setEditing(specialty);setName(specialty.name);setColor(specialty.color);setError('')}
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const response=await fetch('/api/admin/specialties',{method:editing?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(editing?{id:editing.id,name,color}:{name,color})});const data=await response.json();if(!response.ok){setError(data.error??'No se pudo guardar');setBusy(false);return}setEditing(null);setName('');setColor('#64748b');await load();onChanged();setBusy(false)}
  async function remove(specialty:Specialty){if(!confirm(`¿Eliminar la especialidad ${specialty.name}?`))return;setError('');const response=await fetch(`/api/admin/specialties?id=${specialty.id}`,{method:'DELETE'});const data=await response.json();if(!response.ok){setError(data.error??'No se pudo eliminar');return}await load();onChanged()}
  return <section className="mt-6 rounded-2xl border border-black/5 bg-white p-5 shadow-sm"><h2 className="font-extrabold">Especialidades</h2><p className="text-sm text-[#736f83]">Crea, renombra o elimina las especialidades del catálogo.</p><div className="mt-4 flex flex-wrap gap-2">{items.map(specialty=><span key={specialty.id} className="inline-flex items-center gap-2 rounded-lg border p-2 text-sm"><i className="h-3 w-3 rounded-full" style={{background:specialty.color}}/>{specialty.name}<button type="button" title="Editar" onClick={()=>startEdit(specialty)} className="text-[#736f83] hover:text-black"><Pencil size={14}/></button><button type="button" title="Eliminar" onClick={()=>remove(specialty)} className="text-[#736f83] hover:text-red-600"><Trash2 size={14}/></button></span>)}</div>{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}<form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-semibold">{editing?`Renombrar "${editing.name}"`:'Nueva especialidad'}<input value={name} onChange={e=>setName(e.target.value)} required maxLength={80} className="mt-2 w-56 rounded-xl border p-2.5"/></label><label className="text-sm font-semibold">Color<input type="color" value={color} onChange={e=>setColor(e.target.value)} className="mt-2 h-11 w-16 rounded-xl border p-1"/></label><button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Plus size={16}/>{editing?'Guardar cambios':'Agregar especialidad'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setName('');setError('')}} className="inline-flex items-center gap-1 rounded-xl border px-4 py-2.5 text-sm font-semibold"><X size={15}/>Cancelar</button>}</form></section>
}
