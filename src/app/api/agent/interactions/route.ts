import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { normalizePhone } from '@/lib/phone'
import { touchClientMemory } from '@/lib/client-memory'
import { CANALES, guardarHilo } from '@/lib/agent-thread'

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error:'No autorizado' }, { status:401 })
  const body = await request.json() as { businessId?:string; phone?:string; message?:string; reply?:string; channel?:string; externalId?:string }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !phone || !body.message || !body.reply) return NextResponse.json({ stored:false, reason:'Datos incompletos' })
  const channel = body.channel && CANALES.includes(body.channel) ? body.channel : 'WHATSAPP'
  const db = createAdminClient()
  const { data:client } = await db.from('clients').select('id').eq('business_id',body.businessId).eq('phone',phone).maybeSingle()

  // 2000 = el mismo tope con el que el mensaje agrupado entra al prompt del agente. Con 1000
  // se guardaba una versión recortada de lo que el modelo sí procesó.
  const message = body.message.trim().slice(0,2000)
  const reply = body.reply.trim().slice(0,1500)

  // La memoria del agente cuelga de la ficha del cliente: sin ficha no hay dónde guardarla.
  // El hilo, en cambio, se guarda siempre (ver `@/lib/agent-thread`).
  if (client) {
    // Solo se marca cuándo fue la última conversación. El contenido de la memoria
    // (`conversation_summary`, hechos, preferencias, intención) lo escribe únicamente la
    // herramienta `guardar_memoria` — ver el reparto en `@/lib/client-memory`.
    if (!(await touchClientMemory(db, { clientId:client.id }))) return NextResponse.json({ stored:false }, { status:500 })
  }

  let conversationId: string | null = null
  try {
    const hilo = await guardarHilo(db, {
      businessId: body.businessId,
      clientId: client?.id ?? null,
      channel,
      externalId: body.externalId ?? phone,
      message,
      reply,
    })
    conversationId = hilo.conversationId
  } catch { /* la marca de memoria ya quedó guardada: archivar el hilo nunca tumba la respuesta */ }

  return NextResponse.json({ stored:true, clientId:client?.id ?? null, conversationId })
}
