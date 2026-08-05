# Agente Agen en n8n

El agente se construye con el patrón `Webhook → contexto/memoria → agente IA con herramientas → respuesta`.

## Reglas no negociables

1. El modelo no consulta ni escribe SQL libre.
2. Primero identifica una especialidad y un servicio existente.
3. Solo consulta profesionales mediante `/api/agent/slots` usando el `serviceId` real.
4. Registra clientes nuevos mediante `/api/agent/clients` después de obtener su nombre real.
5. Solo reserva mediante `/api/agent/book`.
6. Los horarios ofrecidos quedan apartados durante 15 minutos y la confirmación debe enviar su `holdId`.
7. Una respuesta HTTP 409 significa que otro cliente tomó el horario o el apartado venció; se vuelve a consultar y se ofrecen alternativas.
8. No se presenta una manicurista para un servicio de peluquería ni viceversa.
9. Antes de preguntar un dato, se consulta `client_memory`; después de reservar se actualiza con `/api/agent/memory`.
10. Nunca se afirma que una reserva fue confirmada si la herramienta no devolvió `booked=true`.
11. Toda modificación se confirma al cliente con servicio, profesional, fecha y hora.

## Credenciales

Crear una credencial HTTP Header Auth con:

- Header: `x-agen-secret`
- Value: el mismo valor de `N8N_WEBHOOK_SECRET` configurado en EasyPanel.

No guardar secretos dentro del JSON del workflow.

## Workflows incluidos

- `01-agen-agent.json`: conversación, memoria, catálogo, búsqueda y reserva segura.
- `02-notification-outbox.json`: reclama recordatorios sin duplicarlos y registra el resultado del proveedor.
- `03-marketing-campaigns.json`: campañas inmediatas o programadas, segmentadas y limitadas a consentimientos vigentes.
- `04-followups-daily.json`: seguimiento automático y resumen diario del equipo; se ejecuta cada hora y cada negocio recibe el resumen a las 07:00 de su zona horaria.

Los workflows 02 y 03 envían un JSON normalizado a un gateway del proveedor. Esto permite conectar WhatsApp Cloud API oficial, correo, Instagram, Messenger o push sin acoplar Agen a una sola empresa. El gateway debe responder `{ "success": true }` o `{ "success": false, "error": "motivo" }`. En campañas de email debe incluir el `recipient.unsubscribeUrl` recibido como enlace visible para cancelar promociones.

Configurar en n8n `AGEN_APP_URL`, `AGEN_WEBHOOK_SECRET`, `AGEN_NOTIFICATION_GATEWAY_URL`, `AGEN_NOTIFICATION_GATEWAY_TOKEN`, `AGEN_MARKETING_GATEWAY_URL` y `AGEN_MARKETING_GATEWAY_TOKEN`. Activar cada workflow únicamente después de probarlo manualmente con las credenciales reales.

## Multimedia y voz (01-agen-agent.json)

- El webhook de entrada acepta opcionalmente `mediaType` (`image`|`audio`) y `mediaUrl`. El nodo "Procesar multimedia" llama a `/api/agent/media`, que transcribe (Whisper) o describe (Vision) SOLO si el negocio activó esa capacidad en `/admin/integraciones`; si no, el agente sigue funcionando solo con texto.
- El nodo "Responder con voz" llama a `/api/agent/voice/reply` después de que el agente responde. Nunca deja al agente mudo: cualquier fallo (sin clave, TTS caído, modo equipo) devuelve `speak:false,sendText:true` y el flujo sigue exactamente como antes.
- El campo `speak`/`sendText`/`audio`/`audioMime` de la respuesta final del webhook debe conectarse al gateway de WhatsApp para que envíe la nota de voz cuando `speak:true`.
