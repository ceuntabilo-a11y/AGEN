-- Entrega durable de la respuesta del agente y rescate de campañas atascadas.
-- Aditiva e idempotente: solo agrega columnas e índices. No modifica ni borra datos.
--
-- 1) `agent_inbox` guarda la respuesta YA VALIDADA antes de intentar mandarla. Si la
--    ejecución de n8n muere entera, la fila queda pendiente y otra pasada reintenta
--    exactamente ese texto: no vuelve a correr el modelo, no llama tools y no puede crear,
--    cancelar ni modificar nada. Solo reintenta el envío.
-- 2) `campaigns.sending_since` marca cuándo empezó un envío, para detectar una campaña que
--    quedó en SENDING porque el proceso murió a mitad.
--
-- Reversible conceptualmente: deshacerla es eliminar exactamente las columnas y el índice que
-- agrega. No se ejecuta ningún borrado acá.

alter table public.agent_inbox
  add column if not exists reply_text text,
  add column if not exists reply_sent_at timestamptz,
  add column if not exists reply_attempts smallint not null default 0,
  add column if not exists reply_claimed_at timestamptz,
  add column if not exists reply_error text;

comment on column public.agent_inbox.reply_text is
  'Respuesta ya revisada por /api/agent/reply. Se guarda antes de enviar para poder reintentar solo el envio.';
comment on column public.agent_inbox.reply_claimed_at is
  'Reclamo del reintento: impide que dos pasadas manden la misma respuesta a la vez.';

-- Índice de trabajo del rescate: solo las respuestas guardadas que todavía no salieron.
create index if not exists agent_inbox_reply_pending_idx
  on public.agent_inbox (created_at)
  where reply_text is not null and reply_sent_at is null;

alter table public.campaigns
  add column if not exists sending_since timestamptz;

comment on column public.campaigns.sending_since is
  'Cuando se tomo la campana para enviarla. Si sigue en SENDING mucho despues, el envio se corto a la mitad.';
