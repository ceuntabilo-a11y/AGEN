'use client'
import { ModalShell } from '@/components/ModalShell'

import { PageHeader } from '@/components/PageHeader'
import { NewCampaignModal } from '@/components/NewCampaignModal'
import { Eye, Mail, MessageCircle, Pencil, Plus, UsersRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ListPlaceholder } from '@/components/ListPlaceholder'

type Recipient = { id:number; status:string; reason:string|null; sent_at:string|null; client:{id:string;full_name:string;phone:string|null;email:string|null}|null }
type Campaign = { id:string;name:string;channel:string;status:string;content:string;audience:{segment?:string};scheduled_at:string|null;sent_at:string|null;campaign_recipients:Recipient[] }

const statusLabels: Record<string,string> = { DRAFT:'Borrador', SCHEDULED:'Programada', SENDING:'Enviando', SENT:'Enviada', CANCELLED:'Cancelada' }

function RecipientModal({ campaign, onClose }: { campaign:Campaign; onClose:()=>void }) {
  return <ModalShell titulo="Destinatarios de la campaña" onClose={onClose}><div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6"><div className="flex items-start justify-between"><div><h2 className="text-xl font-black">Entregas de {campaign.name}</h2><p className="text-sm text-[#736f83]">Historial real registrado por destinatario.</p></div><button aria-label="Cerrar" onClick={onClose}><X/></button></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-[#f7f6fa] text-xs uppercase text-[#736f83]"><tr><th className="p-3">Cliente</th><th>Destino</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>{campaign.campaign_recipients.map((recipient)=><tr key={recipient.id} className="border-t"><td className="p-3 font-bold">{recipient.client?.full_name??'Cliente eliminado'}</td><td>{campaign.channel==='EMAIL'?recipient.client?.email:recipient.client?.phone}</td><td><span className={`rounded-full px-2 py-1 text-xs font-bold ${recipient.status==='SENT'?'bg-emerald-50 text-emerald-700':recipient.status==='FAILED'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`}>{recipient.status}</span>{recipient.reason&&<p className="mt-1 max-w-xs text-xs text-red-600">{recipient.reason}</p>}</td><td>{recipient.sent_at?new Date(recipient.sent_at).toLocaleString('es-CL'):'—'}</td></tr>)}</tbody></table>{campaign.campaign_recipients.length===0&&<p className="p-8 text-center text-sm text-[#736f83]">Esta campaña todavía no tiene entregas registradas.</p>}</div></div></ModalShell>
}

export default function MarketingPage() {
  const [campaigns,setCampaigns] = useState<Campaign[]>([])
  const [error,setError] = useState('')
  const [loading,setLoading] = useState(true)
  const [sending,setSending] = useState('')
  const [show,setShow] = useState(false)
  const [editing,setEditing] = useState<Campaign|null>(null)
  const [viewing,setViewing] = useState<Campaign|null>(null)

  const load = useCallback(() => fetch('/api/admin/campaigns',{cache:'no-store'}).then(async (response) => {
    if (!response.ok) throw new Error('No se pudieron cargar las campañas')
    return response.json()
  }).then((data) => { setCampaigns(data.campaigns??[]); setError('') }).catch((caught) => setError(caught instanceof Error?caught.message:'No se pudieron cargar las campañas')).finally(() => setLoading(false)), [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!campaigns.some((campaign) => campaign.status==='SENDING')) return
    const timer = window.setInterval(load,5000)
    return () => window.clearInterval(timer)
  }, [campaigns,load])

  async function send(campaign:Campaign) {
    const segment = campaign.audience?.segment??'ALL'
    if (!window.confirm(`¿Enviar “${campaign.name}” por ${campaign.channel} al segmento ${segment}? Solo entrarán clientes con consentimiento vigente.`)) return
    setSending(campaign.id)
    setError('')
    const response = await fetch('/api/admin/campaigns/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaignId:campaign.id})})
    const data = await response.json()
    if (response.ok) setCampaigns((items)=>items.map((item)=>item.id===campaign.id?{...item,status:'SENDING'}:item))
    else setError(data.error??'No se pudo iniciar el envío')
    setSending('')
  }

  return <>
    {show&&<NewCampaignModal onClose={()=>setShow(false)} onCreated={load}/>}
    {editing&&<NewCampaignModal campaign={editing} onClose={()=>setEditing(null)} onCreated={load}/>}
    {viewing&&<RecipientModal campaign={viewing} onClose={()=>setViewing(null)}/>}
    <PageHeader title="Marketing" description="Campañas consentidas con trazabilidad real de cada entrega." action={<button onClick={()=>setShow(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#5b3df5] px-4 py-2.5 text-sm font-bold text-white"><Plus size={17}/>Nueva campaña</button>}/>
    {error&&<p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 md:grid-cols-3"><article className="rounded-2xl border bg-white p-5"><UsersRound className="text-[#5b3df5]"/><p className="mt-4 text-sm text-[#736f83]">Campañas</p><b className="text-3xl">{campaigns.length}</b></article><article className="rounded-2xl border bg-white p-5"><MessageCircle className="text-[#5b3df5]"/><p className="mt-4 text-sm text-[#736f83]">Entregas WhatsApp</p><b className="text-3xl">{campaigns.filter((campaign)=>campaign.channel==='WHATSAPP').flatMap((campaign)=>campaign.campaign_recipients).filter((recipient)=>recipient.status==='SENT').length}</b></article><article className="rounded-2xl border bg-white p-5"><Mail className="text-[#5b3df5]"/><p className="mt-4 text-sm text-[#736f83]">Entregas Email</p><b className="text-3xl">{campaigns.filter((campaign)=>campaign.channel==='EMAIL').flatMap((campaign)=>campaign.campaign_recipients).filter((recipient)=>recipient.status==='SENT').length}</b></article></div>
    <div className="mt-6 rounded-2xl border bg-white p-5"><h2 className="font-extrabold">Campañas</h2><div className="mt-4 space-y-3">{campaigns.map((campaign)=>{const sent=campaign.campaign_recipients.filter((recipient)=>recipient.status==='SENT').length,failed=campaign.campaign_recipients.filter((recipient)=>recipient.status==='FAILED').length;return <div key={campaign.id} className="flex flex-col justify-between gap-3 rounded-xl border p-4 lg:flex-row lg:items-center"><div className="min-w-0"><b>{campaign.name}</b><p className="max-w-xl truncate text-sm text-[#736f83]">{campaign.channel} · {campaign.content}</p><p className="mt-1 text-xs text-[#736f83]">{sent} entregadas{failed?` · ${failed} fallidas`:''}</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">{statusLabels[campaign.status]??campaign.status}</span><button title="Ver destinatarios" onClick={()=>setViewing(campaign)} className="rounded-lg border p-2"><Eye size={16}/></button>{campaign.status!=='SENDING'&&<button title="Editar" onClick={()=>setEditing(campaign)} className="rounded-lg border p-2"><Pencil size={16}/></button>}{['DRAFT','SENT','CANCELLED'].includes(campaign.status)&&<button onClick={()=>send(campaign)} disabled={sending===campaign.id} className="rounded-lg bg-[#5b3df5] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{sending===campaign.id?'Enviando…':campaign.status==='SENT'?'Reenviar':'Enviar'}</button>}</div></div>})}{campaigns.length===0&&<ListPlaceholder loading={loading} error={Boolean(error)} className="py-6 text-center text-sm text-[#736f83]">Aún no hay campañas.</ListPlaceholder>}</div></div>
  </>
}
