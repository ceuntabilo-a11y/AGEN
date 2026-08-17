-- Recordatorios que decide cada negocio, no el código.
--
-- Hasta ahora había DOS avisos fijos por cita: petición de confirmación la tarde anterior
-- (`CONFIRM_REQUEST`) y recordatorio la mañana del día (`DAY_OF_REMINDER`), a horas del reloj
-- que el negocio podía mover pero no elegir de verdad. Los tipos `REMINDER_24H` y `REMINDER_2H`
-- existían en el esquema, en las plantillas y en el despachador, pero ninguna función los
-- encolaba: eran código muerto.
--
-- Ahora cada negocio define su propia lista en `businesses.settings.reminders`:
--
--   "reminders": [ {"hoursBefore": 24, "enabled": true}, {"hoursBefore": 2, "enabled": true} ]
--
-- Sin esa clave se usan 24 h y 2 h antes, que es el valor por defecto sugerido. Un negocio
-- puede poner uno, tres o ninguno, y a las horas que quiera.
--
-- Idempotente. No borra datos de clientes ni de citas: solo reprograma la cola de avisos
-- pendientes de las citas futuras al final.

-- ── 1. Un tipo de recordatorio genérico, con las horas en el payload ─────────────────────────

alter table public.notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check
  check (event_type in (
    'BOOKED','REMINDER','REMINDER_24H','REMINDER_2H','RESCHEDULED','CANCELLED','FOLLOW_UP','REVIEW_REQUEST',
    'CHANGED','CONFIRM_REQUEST','DAY_OF_REMINDER','WAITLIST_SLOT'
  ));

-- La unicidad de los avisos programados ahora distingue también CUÁNTAS horas antes es cada
-- uno: sin esto, dos recordatorios de la misma cita (24 h y 2 h) se pisarían entre ellos.
drop index if exists public.notification_outbox_scheduled_uq;
create unique index if not exists notification_outbox_scheduled_uq
  on public.notification_outbox (appointment_id, event_type, channel, (coalesce(payload->>'hoursBefore', '')))
  where event_type in ('REMINDER','REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');

-- ── 2. Encolado: 'REMINDER' también es un aviso programado ──────────────────────────────────

create or replace function public.enqueue_appointment_event(
  p_appointment_id uuid,
  p_event_type text,
  p_scheduled_at timestamptz default now(),
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_phone text;
  v_email text;
  v_channel text;
  v_scheduled boolean;
  v_hours text;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found then return; end if;

  select phone, email into v_phone, v_email from public.clients where id = v_appointment.client_id;
  v_channel := case when nullif(btrim(v_phone), '') is not null then 'WHATSAPP'
                    when nullif(btrim(v_email), '') is not null then 'EMAIL'
                    else null end;
  if v_channel is null then return; end if;

  v_scheduled := p_event_type in ('REMINDER','REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');
  v_hours := coalesce(p_payload->>'hoursBefore', '');

  -- Los avisos programados son únicos por cita y por antelación: al mover la cita se
  -- reprograman, no se duplican.
  if v_scheduled then
    delete from public.notification_outbox
      where appointment_id = p_appointment_id
        and event_type = p_event_type
        and channel = v_channel
        and coalesce(payload->>'hoursBefore', '') = v_hours;
  end if;

  insert into public.notification_outbox (
    business_id, appointment_id, client_id, event_type, channel, payload, scheduled_at
  ) values (
    v_appointment.business_id,
    v_appointment.id,
    v_appointment.client_id,
    p_event_type,
    v_channel,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('appointmentId', v_appointment.id),
    p_scheduled_at
  );
end;
$$;

revoke all on function public.enqueue_appointment_event(uuid,text,timestamptz,jsonb) from public, anon;
grant execute on function public.enqueue_appointment_event(uuid,text,timestamptz,jsonb) to service_role;

-- ── 3. La programación sale de la configuración del negocio ─────────────────────────────────

create or replace function public.schedule_appointment_reminders(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_settings jsonb;
  v_reminders jsonb;
  v_entry jsonb;
  v_hours numeric;
  v_at timestamptz;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found or v_appointment.status not in ('PENDING','CONFIRMED') then return; end if;

  select coalesce(settings, '{}'::jsonb) into v_settings
    from public.businesses where id = v_appointment.business_id;
  if v_settings is null then return; end if;

  v_reminders := v_settings->'reminders';

  -- Sin configuración, el valor sugerido: 24 h y 2 h antes.
  if v_reminders is null or jsonb_typeof(v_reminders) <> 'array' then
    v_reminders := '[{"hoursBefore":24,"enabled":true},{"hoursBefore":2,"enabled":true}]'::jsonb;
  end if;

  for v_entry in select * from jsonb_array_elements(v_reminders) loop
    continue when coalesce((v_entry->>'enabled')::boolean, true) = false;

    begin
      v_hours := (v_entry->>'hoursBefore')::numeric;
    exception when others then
      v_hours := null;
    end;
    continue when v_hours is null or v_hours < 0.25 or v_hours > 336;

    v_at := lower(v_appointment.service_period) - make_interval(mins => round(v_hours * 60)::integer);

    -- Nunca en el pasado, ni después de la propia cita.
    if v_at > now() and v_at < lower(v_appointment.service_period) then
      perform public.enqueue_appointment_event(
        p_appointment_id, 'REMINDER', v_at,
        jsonb_build_object('hoursBefore', trim(trailing '.' from trim(trailing '0' from to_char(v_hours, 'FM9999990.99'))))
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.schedule_appointment_reminders(uuid) from public, anon;
grant execute on function public.schedule_appointment_reminders(uuid) to service_role;

-- ── 4. Los avisos viejos que ya no se programan se limpian y se reprograman ─────────────────
--
-- Solo toca la cola de avisos PENDIENTES de citas FUTURAS: nada de historial, nada de citas
-- pasadas, ninguna cita se modifica.

delete from public.notification_outbox o
  using public.appointments a
  where o.appointment_id = a.id
    and o.processed_at is null
    and o.event_type in ('CONFIRM_REQUEST','DAY_OF_REMINDER','REMINDER_24H','REMINDER_2H')
    and lower(a.service_period) > now();

do $$
declare v_id uuid;
begin
  for v_id in
    select id from public.appointments
     where status in ('PENDING','CONFIRMED') and lower(service_period) > now()
  loop
    perform public.schedule_appointment_reminders(v_id);
  end loop;
end $$;
