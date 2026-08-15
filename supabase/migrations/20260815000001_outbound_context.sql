-- Contexto de los mensajes automáticos que AGEN le manda al cliente.
--
-- El problema que resuelve, observado en producción: un recordatorio automático le dijo al
-- cliente «Responde Sí para confirmar que vienes. Si no puedes, responde NO…», el cliente
-- contestó «No» y el agente le preguntó «¿A qué te refieres con "no"?». El agente no tenía
-- forma de saber qué le había mandado el negocio: la cola de avisos (`notification_outbox`)
-- se procesa y se olvida, así que cuando llega la respuesta ya no queda rastro de la pregunta.
--
-- Esto no es un fallo de un recordatorio concreto: le pasa a TODO mensaje saliente que pueda
-- recibir respuesta (recordatorios, confirmaciones, avisos de cambio, cancelaciones, cupos de
-- lista de espera, seguimientos, encuestas y campañas de marketing). Por eso el registro es
-- uno solo y vive aparte de la cola: la cola es el intento de envío, esto es la conversación.
--
-- Cada fila guarda: qué se envió, por qué, sobre qué entidad, qué respuesta se espera y hasta
-- cuándo es relevante. El agente lo lee antes de interpretar un «sí», un «no» o un «después».
--
-- Aditiva e idempotente: crea una tabla, sus índices, su política de lectura y un disparador.
-- No modifica ni borra ningún dato existente. Deshacerla es eliminar exactamente eso.

create table if not exists public.outbound_prompts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  channel text not null check (channel in ('WHATSAPP', 'EMAIL')),
  -- El mismo vocabulario que `notification_outbox.event_type`, más los envíos que no son
  -- avisos de cita. Sin `check` cerrado a propósito: una automatización nueva no puede
  -- quedarse sin registrar su contexto por culpa de una restricción.
  kind text not null,
  appointment_id uuid references public.appointments(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  -- Qué se espera de vuelta. Es lo que le dice al agente cómo leer una respuesta suelta.
  expects text not null default 'FREE' check (expects in ('YES_NO', 'CHOICE', 'RATING', 'FREE', 'NONE')),
  -- La pregunta en una línea, tal como la entendería una persona.
  question text not null,
  -- Por qué se envió y sobre qué (motivo del cambio, hora anterior, servicio…).
  summary text,
  -- Qué significa un «sí» y qué un «no» PARA ESTE mensaje. Se guardan con el aviso, y no en el
  -- prompt del agente, por dos razones: el prompt se paga entero en cada turno de cada
  -- conversación, y así un aviso ya enviado sigue significando lo que significaba al salir
  -- aunque mañana cambie la plantilla. Un «sí» a una cancelación pide horarios nuevos; un «sí»
  -- a un cambio de hora confirma la hora nueva: son opuestos y el agente no puede adivinarlo.
  if_yes text,
  if_no text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  -- Hasta cuándo tiene sentido leer una respuesta como respuesta a ESTO.
  expires_at timestamptz not null,
  answered_at timestamptz,
  resolution text,
  answer text
);

comment on table public.outbound_prompts is
  'Mensajes automaticos enviados al cliente que pueden recibir respuesta. El agente los lee para interpretar "si", "no", "ok" o "despues".';
comment on column public.outbound_prompts.expects is
  'Que respuesta se espera: YES_NO, CHOICE, RATING, FREE o NONE (informativo, no espera nada).';
comment on column public.outbound_prompts.expires_at is
  'Hasta cuando es relevante. Pasado ese instante el agente ya no lo usa para interpretar una respuesta suelta.';
comment on column public.outbound_prompts.resolution is
  'Como dejo de estar pendiente: CONFIRMED, RELEASED, RESCHEDULED, CANCELLED, ANSWERED o EXPIRED.';

alter table public.outbound_prompts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'outbound_prompts' and policyname = 'outbound_prompts_member_read'
  ) then
    create policy outbound_prompts_member_read on public.outbound_prompts
      for select using (public.is_business_member(business_id));
  end if;
end $$;

-- Índice de trabajo del agente: el último aviso vigente de una persona, en una sola pasada.
create index if not exists outbound_prompts_pending_idx
  on public.outbound_prompts (business_id, client_id, sent_at desc)
  where answered_at is null;

create index if not exists outbound_prompts_appointment_idx
  on public.outbound_prompts (appointment_id)
  where answered_at is null;

-- Cerrar el aviso cuando la respuesta ya se materializó, venga de donde venga.
--
-- Es un disparador y no una llamada desde la aplicación a propósito: la misma cita se puede
-- confirmar desde el agente, desde el panel del negocio o desde el portal del cliente, y las
-- tres tienen que cerrar el aviso. Poner la regla en la tabla es la única forma de que ninguna
-- ruta futura se olvide.
create or replace function public.resolve_outbound_prompts_for_appointment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_resolution text;
begin
  if new.status = 'CANCELLED' and old.status is distinct from 'CANCELLED' then
    v_resolution := 'RELEASED';
  elsif new.client_confirmed_at is not null and old.client_confirmed_at is null then
    v_resolution := 'CONFIRMED';
  elsif new.service_period is distinct from old.service_period then
    v_resolution := 'RESCHEDULED';
  elsif new.status is distinct from old.status and new.status not in ('PENDING', 'CONFIRMED') then
    v_resolution := 'CLOSED';
  else
    return new;
  end if;

  update public.outbound_prompts
     set answered_at = now(), resolution = v_resolution
   where appointment_id = new.id and answered_at is null;

  return new;
end $$;

drop trigger if exists appointments_resolve_outbound_prompts on public.appointments;
create trigger appointments_resolve_outbound_prompts
  after update on public.appointments
  for each row execute function public.resolve_outbound_prompts_for_appointment();
