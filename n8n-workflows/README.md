# Agente Agen en n8n

El agente ya no es un modelo con nueve herramientas decidiendo solo. Es un **router de
intención**: la app decide por qué rama va cada turno, cada rama tiene sus propias herramientas
(o ninguna), y **ninguna rama puede ejecutar una acción**. Reservar, cancelar, mover y confirmar
lo hace un paso fijo de código.

```
Evolution → Webhook → Autorizar → Entrada → ¿Se atiende? ─no→ Ignorar
  → Marcar leído → Escribiendo… → Registrar → Esperar → Agrupar
  → ¿Responde este? ─no→ Ya respondió otro (contesta al webhook)
  → ¿Trae multimedia? ─sí→ Bajar multimedia (Evolution)
  → Turno  ······································· POST /api/agent/turn
  → ¿Hay contexto? ─no→ "No pude consultar"  (el turno NO sigue a ciegas)
  → ¿Respuesta directa? ─sí→ Respuesta directa      (0 llamadas al modelo)
  → ¿Busca horarios?    ─sí→ Buscador               (1 herramienta: buscar_horarios)
  → ¿Decide una acción? ─sí→ Decisor → Ejecutar acción ··· POST /api/agent/act
                        ─no→ Redactor               (0 herramientas)
  → Enviar a WhatsApp ··························· POST /api/agent/reply
  → Persistir interacción → Responder
```

## Reglas no negociables

1. El modelo no consulta ni escribe SQL libre.
2. **El modelo no ejecuta acciones.** `crear_reserva`, `liberar_reserva`, `mover_reserva`,
   `confirmar_reserva` y `registrar_cliente` dejaron de ser herramientas: son intenciones que
   valida y ejecuta `POST /api/agent/act`.
3. La única herramienta que queda es `buscar_horarios`, y cuelga **solo** de la rama Buscador.
4. `POST /api/agent/act` no se fía del JSON del decisor: relee de la base quién es el cliente,
   qué reservas vigentes tiene y qué apartados siguen vivos, y solo acepta identificadores que
   estén en esas listas. Sin `confirmado: true` no ejecuta nada.
5. El texto de una acción hecha (reservada, movida, cancelada, confirmada) lo escribe la app con
   los datos que devolvió la base, nunca el modelo.
6. Los horarios ofrecidos quedan apartados **10 minutos** (`MINUTOS_APARTADO` en
   `/api/agent/slots`) y solo se puede reservar contra un apartado vivo de un turno anterior.
7. Sin reservas vigentes, el router impide cancelar, mover y confirmar antes de llamar a ningún
   modelo.
8. Las instrucciones de cada rama viven en `src/lib/agent-router.ts`, no en el lienzo: son
   código versionado y con pruebas. Los nodos las reciben en `systemMessage`.

## Credenciales

Credencial HTTP Header Auth con header `x-agen-secret` y el valor de `N8N_WEBHOOK_SECRET`.
No se guardan secretos dentro del JSON del workflow.

Variables que usa el workflow 01: `AGEN_APP_URL`, `AGEN_WEBHOOK_SECRET`, `EVOLUTION_API_URL`,
`EVOLUTION_API_KEY`.

## Workflows incluidos

- `01-agen-agent.json`: router de intención, ramas y ejecutor fijo.
- `02-notification-outbox.json`: dispara la cola de avisos y reintenta las respuestas del agente.
- `03-marketing-campaigns.json`: campañas segmentadas y limitadas a consentimientos vigentes.
- `04-followups-daily.json`: seguimiento automático y resumen diario del equipo.

`n8n-workflows/respaldo/01-agen-agent.ANTES-DEL-ROUTER.json` es el workflow que estaba vivo
antes de este cambio, exportado tal cual del n8n real. Para volver atrás:
`npm run n8n -- subir n8n-workflows/respaldo/01-agen-agent.ANTES-DEL-ROUTER.json <id>`.

## Cómo se regenera el workflow 01

```
node scripts/construir-workflow-router.mjs
```

Copia del respaldo los nodos que ya funcionaban en producción (puerta de entrada, agrupado de
mensajes, herramienta de horarios con su preámbulo) letra por letra, y añade el router. Así una
corrección ganada contra un fallo real no se pierde al reescribir.

## Multimedia y voz

- El nodo `Bajar multimedia` le pide el contenido a Evolution
  (`/chat/getBase64FromMediaMessage`) porque la URL del webhook viene cifrada por WhatsApp, y lo
  manda como data URI. `POST /api/agent/turn` lo transcribe (Whisper) o lo describe (Vision)
  **solo si el negocio activó esa capacidad** (`feature_voice` / `feature_image`).
- Si el cliente manda la foto de un trabajo y el negocio tiene portafolio publicado con
  consentimiento, la app elige una foto real y `POST /api/agent/reply` la adjunta. La elige la
  consulta, no el modelo.
- La voz de la respuesta la decide `agent_settings` del negocio y la envía `/api/agent/reply`
  (Evolution). Cualquier fallo cae a texto: nunca deja al agente mudo.

## Orden de despliegue (importante)

`npm run n8n -- subir` comprueba antes que las rutas nuevas existan en producción y **se niega**
a subir si no están: un workflow llamando a un 404 son clientes sin respuesta. El orden es
siempre: migración SQL → desplegar la app → subir el workflow → probar → activar.
