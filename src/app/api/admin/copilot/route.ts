import {NextResponse} from 'next/server'
import {apiError} from '@/lib/http-errors'
import {requireBusinessContext} from '@/lib/supabase-server'
import {dateKeyInZone,zonedDayRange} from '@/lib/timezone'
import {rateLimited} from '@/lib/rate-limit'
import {chatCompletion,resolveOpenAiKey} from '@/lib/openai'
import {ARTICULOS_AYUDA,categoriaDePagina,nombreDePagina} from '@/lib/help-content'
import {buscarAyuda} from '@/lib/help-search'

export async function POST(request:Request){
  try{
    const {db,businessId}=await requireBusinessContext(['OWNER','ADMIN','RECEPTIONIST'])
    if(rateLimited(`copilot:${businessId}`,30,60_000))return NextResponse.json({error:'Demasiadas preguntas seguidas, espera un minuto'},{status:429})
    const body=await request.json().catch(()=>({})) as {question?:string;page?:string}
    const question=body.question?.trim().slice(0,300)
    const pagina=String(body.page??'').slice(0,200)
    if(!question)return NextResponse.json({error:'Escribe una pregunta'},{status:400})
    const {data:business,error:businessError}=await db.from('businesses').select('timezone,currency,openai_api_key').eq('id',businessId).single()
    if(businessError)throw businessError
    const day=dateKeyInZone(new Date(),business.timezone),{from,until}=zonedDayRange(day,business.timezone)
    const [appointments,followups,waitlist,clients,professionals,services,payments]=await Promise.all([
      db.from('appointments').select('id,status').eq('business_id',businessId).overlaps('service_period',`[${from},${until})`).not('status','eq','CANCELLED'),
      db.from('follow_up_tasks').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('status','PENDING').lte('due_on',day),
      db.from('waitlist_entries').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('status','WAITING'),
      db.from('clients').select('id',{count:'exact',head:true}).eq('business_id',businessId),
      db.from('professionals').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('active',true),
      db.from('services').select('id',{count:'exact',head:true}).eq('business_id',businessId).eq('active',true),
      db.from('payments').select('amount').eq('business_id',businessId).eq('status','PAID').gte('paid_at',from).lt('paid_at',until),
    ])
    const failed=[appointments,followups,waitlist,clients,professionals,services,payments].find(result=>result.error)
    if(failed?.error)throw failed.error
    const rows=appointments.data??[],confirmed=rows.filter(item=>item.status==='CONFIRMED').length,pending=rows.filter(item=>item.status==='PENDING').length
    const revenue=(payments.data??[]).reduce((sum,item)=>sum+Number(item.amount),0)
    const money=new Intl.NumberFormat('es-CL',{style:'currency',currency:business.currency||'CLP',maximumFractionDigits:0}).format(revenue)
    const text=question.toLocaleLowerCase('es')
    const route=
      /agenda|cita|reserva|hoy|confirm/.test(text)?{reply:`Hoy hay ${rows.length} reservas: ${confirmed} confirmadas y ${pending} pendientes.`,href:'/admin/agenda',label:'Abrir agenda'}:
      /seguimiento|ausen|presupuesto|espera|contactar/.test(text)?{reply:`Hay ${followups.count??0} tareas para atender y ${waitlist.count??0} clientes esperando un cupo.`,href:'/admin/seguimiento',label:'Abrir seguimiento'}:
      /dinero|ingreso|venta|pago|caja|finanza/.test(text)?{reply:`Los pagos registrados hoy suman ${money}.`,href:'/admin/finanzas',label:'Abrir finanzas'}:
      /cliente/.test(text)?{reply:`El negocio tiene ${clients.count??0} clientes registrados.`,href:'/admin/clientes',label:'Abrir clientes'}:
      /equipo|profesional|estilista|manicur/.test(text)?{reply:`Hay ${professionals.count??0} profesionales activos.`,href:'/admin/equipo',label:'Abrir equipo'}:
      /servicio|especialidad|precio/.test(text)?{reply:`Hay ${services.count??0} servicios activos en el catálogo.`,href:'/admin/servicios',label:'Abrir servicios'}:
      {reply:`Hoy: ${rows.length} reservas, ${followups.count??0} seguimientos y ${waitlist.count??0} personas esperando cupo. Puedo ayudarte con agenda, clientes, equipo, servicios, seguimiento o finanzas.`,href:'/admin',label:'Abrir resumen'}
    const facts=`Reservas hoy: ${rows.length} (${confirmed} confirmadas, ${pending} pendientes). Tareas de seguimiento pendientes: ${followups.count??0}. Clientes esperando cupo: ${waitlist.count??0}. Pagos de hoy: ${money}. Clientes registrados: ${clients.count??0}. Profesionales activos: ${professionals.count??0}. Servicios activos: ${services.count??0}.`

    /*
     * El mismo buscador sin costo de IA del Centro de ayuda (Tanda 9) filtra qué artículos son
     * relevantes ANTES de llamar al modelo: por la pregunta, y por la pantalla donde está parado
     * el dueño (aunque pregunte algo que no calza con ningún alias). Así el modelo explica cómo
     * funciona Agen citando SOLO hechos reales ya escritos, en vez de inventar un botón que no
     * existe.
     */
    const categoriaActual=categoriaDePagina(pagina)
    const porPregunta=buscarAyuda(question,ARTICULOS_AYUDA,4)
    const porPantalla=categoriaActual?ARTICULOS_AYUDA.filter(articulo=>articulo.categoria===categoriaActual):[]
    const articulos=Array.from(new Map([...porPregunta,...porPantalla].map(articulo=>[articulo.id,articulo])).values()).slice(0,8)
    const ayuda=articulos.map(articulo=>`- ${articulo.pregunta} → ${articulo.respuesta}`).join('\n')

    const {key}=await resolveOpenAiKey(business.openai_api_key)
    if(key){
      try{
        const reply=await chatCompletion(key,[
          {role:'system',content:'Eres el asistente interno de Agen: solo lectura, nunca ejecutás ninguna acción vos mismo (no reservás, no cambiás nada, no borrás nada) — si el dueño quiere hacer algo, decile el botón y la pantalla exactos, nunca digas que ya lo hiciste. Podés explicar cómo funciona cualquier parte de la app y contar datos reales del negocio. USA ÚNICAMENTE los datos y artículos entregados, nunca inventes cifras, botones ni pantallas que no estén ahí — si no sabés algo, decilo claramente. Responde en español, natural, en máximo 4 líneas cortas.'},
          {role:'user',content:`Pantalla actual del dueño: ${nombreDePagina(pagina)}\nDatos reales del negocio hoy: ${facts}\nArtículos de ayuda relevantes:\n${ayuda||'(ninguno coincide con esta pregunta)'}\nPregunta: ${question}`},
        ])
        return NextResponse.json({reply,href:route.href,label:route.label})
      }catch{}
    }
    return NextResponse.json(route)
  }catch(error){return apiError(error)}
}
