# Agente Agen en n8n

El agente se construye con el patrón `Webhook → contexto/memoria → agente IA con herramientas → respuesta`.

## Reglas no negociables

1. El modelo no consulta ni escribe SQL libre.
2. Primero identifica una especialidad y un servicio existente.
3. Solo consulta profesionales mediante `/api/agent/availability` usando el `serviceId` real.
4. Solo reserva mediante `/api/agent/book`.
5. Una respuesta HTTP 409 significa que otro cliente tomó el horario; se vuelve a consultar y se ofrecen alternativas.
6. No se presenta una manicurista para un servicio de peluquería ni viceversa.
7. Antes de preguntar un dato, se consulta `client_memory` y el resumen de conversación.
8. Toda modificación se confirma al cliente con servicio, profesional, fecha y hora.

## Credenciales

Crear una credencial HTTP Header Auth con:

- Header: `x-agen-secret`
- Value: el mismo valor de `N8N_WEBHOOK_SECRET` configurado en EasyPanel.

No guardar secretos dentro del JSON del workflow.

## Workflows incluidos

- `01-agen-agent.json`: conversación, memoria, catálogo, búsqueda y reserva segura.
- `02-notification-outbox.json`: reclama recordatorios sin duplicarlos y registra el resultado del proveedor.
- `03-marketing-campaigns.json`: campañas inmediatas o programadas, segmentadas y limitadas a consentimientos vigentes.

Los workflows 02 y 03 envían un JSON normalizado a un gateway del proveedor. Esto permite conectar WhatsApp Cloud API, correo, Instagram, Messenger o push sin acoplar Agen a una sola empresa. El gateway debe responder `{ "success": true }` o `{ "success": false, "error": "motivo" }`.

Configurar en n8n `AGEN_APP_URL`, `AGEN_WEBHOOK_SECRET`, `AGEN_NOTIFICATION_GATEWAY_URL`, `AGEN_NOTIFICATION_GATEWAY_TOKEN`, `AGEN_MARKETING_GATEWAY_URL` y `AGEN_MARKETING_GATEWAY_TOKEN`. Activar cada workflow únicamente después de probarlo manualmente con las credenciales reales.
