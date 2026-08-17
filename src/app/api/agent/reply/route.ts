import { NextResponse } from 'next/server'
import { isAuthorizedAgent } from '@/lib/agent-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { isRealClientPhone, normalizePhone } from '@/lib/phone'
import { sendWhatsApp, sendWhatsAppAudio } from '@/lib/whatsapp'
import { vozParaRespuesta } from '@/lib/agent-voz'
import { reunirEvidencia, revisarRespuesta, type RevisionRespuesta } from '@/lib/agent-reply'
import { formatearParaWhatsApp } from '@/lib/whatsapp-format'
import { guardarRespuestaPendiente, marcarRespuestaEnviada, marcarRespuestaFallida } from '@/lib/agent-reply-delivery'

/**
 * Única puerta de salida del agente hacia el cliente (A5).
 *
 * Antes n8n mandaba el texto del modelo directo a Evolution: sin revisar nada, sin poder
 * detectar un fallo de envío y sin funcionar para los negocios que usan META o 360dialog.
 *
 * Acá se hacen tres cosas, en este orden:
 * 1. Revisar el texto contra lo que DE VERDAD pasó en la base (ver `@/lib/agent-reply`): una
 *    reserva inventada, un volcado técnico o una respuesta vacía no salen nunca.
 * 2. Enviarlo por el proveedor que tenga configurado el negocio.
 * 3. Responder si se entregó o no. Un fallo devuelve 502 para que la ejecución de n8n quede
 *    marcada como fallida y reintente EL MISMO texto (el modelo no vuelve a correr, así que
 *    un reintento no puede producir una segunda reserva).
 */

/**
 * Ventana de respaldo para buscar evidencia cuando no se sabe cuándo empezó el turno.
 *
 * Se usa SOLO si el mensaje no trae `messageId`; con él, la ventana empieza en el instante en
 * que entró ese mensaje, que es lo que de verdad significa "este turno".
 */
const VENTANA_MINUTOS = 15

/** Margen hacia atrás sobre la llegada del mensaje, por el desfase de relojes entre servicios. */
const MARGEN_SEGUNDOS = 30

export async function POST(request: Request) {
  if (!isAuthorizedAgent(request)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = await request.json() as {
    businessId?: string; phone?: string; reply?: string; instance?: string; messageId?: string
    /** Rama del router por la que salió este texto. INFO y BUSCAR no pueden mutar nada. */
    rama?: string
    /** `CODIGO` = el texto lo construyó `/api/agent/act` con datos de la base: no se revisa. */
    origen?: string
    imageUrl?: string | null
    wasAudio?: boolean
    actorType?: string
  }
  const phone = normalizePhone(body.phone)
  if (!body.businessId || !isRealClientPhone(phone)) return NextResponse.json({ error: 'Negocio o teléfono inválido' }, { status: 400 })

  const db = createAdminClient()
  /*
   * El negocio y el cliente no dependen el uno del otro: pedirlos en fila era un viaje de ida y
   * vuelta a la base regalado en CADA respuesta, y este endpoint está en el camino crítico —
   * hasta que termina, el cliente no ha visto nada. Medido contra producción, el nodo "Enviar a
   * WhatsApp" tardaba 3–4,3 s.
   */
  const [negocio, cliente, entrada] = await Promise.all([
    db.from('businesses')
      .select('id,whatsapp_provider,whatsapp_instance,whatsapp_phone_id,whatsapp_token,whatsapp_360_api_key')
      .eq('id', body.businessId).eq('active', true).maybeSingle(),
    db.from('clients').select('id')
      .eq('business_id', body.businessId).eq('phone', phone).maybeSingle(),
    body.messageId
      ? db.from('agent_inbox').select('created_at')
        .eq('business_id', body.businessId).eq('phone', phone).eq('message_id', body.messageId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const business = negocio.data
  const client = cliente.data
  if (!business) return NextResponse.json({ error: 'Negocio inexistente' }, { status: 404 })

  /*
   * "Este turno" empieza cuando llegó ESTE mensaje, no hace quince minutos.
   *
   * Fallo real (ejecuciones 9343 y 9345 del n8n de producción, con dos minutos de diferencia):
   * en la primera el agente reservó una hora; en la segunda el cliente escribió "no puedo ir,
   * cancela esa hora" y el modelo devolvió un texto vacío. La revisión lo bloqueó —bien— y
   * eligió el respaldo mirando la evidencia de los últimos 15 minutos, así que encontró la
   * reserva del turno ANTERIOR y le contestó "Listo, tu hora quedó reservada" a alguien que
   * acababa de pedir cancelarla.
   *
   * Con la marca de llegada del mensaje, la evidencia solo puede ser de este turno. Sin
   * `messageId` —o si la fila todavía no está— se conserva la ventana antigua: es peor, pero es
   * exactamente lo que había, así que nada empeora.
   */
  const llegada = (entrada.data as { created_at?: string } | null)?.created_at
  const desde = llegada
    ? new Date(new Date(llegada).getTime() - MARGEN_SEGUNDOS * 1000).toISOString()
    : new Date(Date.now() - VENTANA_MINUTOS * 60000).toISOString()
  /*
   * Texto escrito por código (`/api/agent/act`): no se revisa, porque no hay nada que revisar.
   * Sale de los campos que devolvió la base de datos después de ejecutar la acción, así que no
   * puede afirmar algo que no ocurrió — que es justo lo único que la revisión buscaba.
   */
  const deCodigo = String(body.origen ?? '').toUpperCase() === 'CODIGO'
  const ramaSinAcciones = ['INFO', 'BUSCAR'].includes(String(body.rama ?? '').toUpperCase())

  const evidencia = deCodigo
    ? { reservo: false, cancelo: false, confirmo: false, ultima: null }
    : { ...await reunirEvidencia(db, { businessId: body.businessId, clientId: client?.id ?? null, desde }), ramaSinAcciones }
  const textoDeCodigo = String(body.reply ?? '').trim()
  const revision: RevisionRespuesta = deCodigo && textoDeCodigo
    ? { texto: textoDeCodigo, bloqueada: false, motivos: [] }
    : revisarRespuesta(String(body.reply ?? ''), evidencia)

  /*
   * Presentación, y solo presentación (ver `@/lib/whatsapp-format`).
   *
   * Va DESPUÉS de la revisión y solo sobre un texto aprobado: los respaldos ya son una línea
   * limpia y no hay nada que ordenar en ellos. La capa no puede cambiar ni una letra —lo
   * comprueba comparando la firma del texto—, así que no altera lo que el agente decidió decir
   * ni lo que hizo; solo cómo se ve.
   */
  const texto = revision.bloqueada ? revision.texto : formatearParaWhatsApp(revision.texto)

  // Si el negocio todavía no tiene proveedor guardado, se usa la instancia de Evolution por
  // la que entró el mensaje: es la que venía usando el workflow y no se puede romper.
  const instancia = body.instance?.trim() || null
  const proveedor = {
    ...business,
    whatsapp_provider: business.whatsapp_provider || (instancia ? 'EVOLUTION' : null),
    whatsapp_instance: business.whatsapp_instance || instancia,
  }

  // Se guarda ANTES de mandar: si esta ejecución muere ahora mismo, la respuesta queda
  // pendiente y otra pasada la reintenta tal cual, sin volver a correr el modelo.
  const clave = body.messageId ? { businessId: body.businessId, phone, messageId: body.messageId } : null
  const guardado = clave
    ? await guardarRespuestaPendiente(db, { ...clave, texto })
    : { durable: false, guardada: false }

  /*
   * Voz (requisito F). La decisión es del negocio y está en `agent_settings`; acá solo se
   * ejecuta. Si el negocio no la activó, si no hay clave o si el proveedor no soporta audio,
   * `speak` es false y sale el texto de siempre: el cliente nunca se queda sin respuesta.
   */
  const voz = revision.bloqueada
    ? { speak: false, sendText: true }
    : await vozParaRespuesta(db, { businessId: body.businessId, text: texto, wasAudio: body.wasAudio, actorType: body.actorType })

  let audioEnviado = false
  if (voz.speak && voz.audio) {
    const envioAudio = await sendWhatsAppAudio(proveedor, { phone, audioBase64: voz.audio })
    audioEnviado = envioAudio.success
  }

  // Con el audio entregado y el negocio configurado para no duplicar, no se manda el texto.
  const envio = audioEnviado && voz.sendText === false
    ? { success: true as const, error: undefined }
    : await sendWhatsApp(proveedor, { phone, text: texto, imageUrl: body.imageUrl ?? null })

  const cuerpo = {
    text: texto, blocked: revision.bloqueada, reasons: revision.motivos, durable: guardado.guardada,
    voice: audioEnviado, image: Boolean(body.imageUrl),
  }

  if (!envio.success) {
    if (clave && guardado.guardada) await marcarRespuestaFallida(db, clave, envio.error ?? 'envio_fallido')
    return NextResponse.json({ sent: false, ...cuerpo, error: envio.error ?? 'envio_fallido' }, { status: 502 })
  }
  if (clave && guardado.guardada) await marcarRespuestaEnviada(db, clave)
  return NextResponse.json({ sent: true, ...cuerpo })
}
