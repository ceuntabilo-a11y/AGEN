-- Avisos reales al cliente ante cualquier cambio de su cita + confirmación previa + lista de espera.
--
-- 1) La cola de notificaciones deja de permitir un solo aviso por tipo y cita: un cambio puede
--    ocurrir muchas veces y cada uno se avisa. Solo los avisos programados (confirmación y
--    recordatorio del día) siguen siendo únicos, porque se reprograman al mover la cita.
-- 2) Las funciones *_safe_appointment aceptan motivo y autor, y encolan el aviso con todo el
--    detalle (qué cambió, de qué a qué, quién y por qué).
-- 3) Se programan dos avisos por cita: confirmación la tarde anterior y recordatorio la mañana
--    del día, ambos a la hora que configure el negocio y en su zona horaria.
-- 4) Al liberarse un cupo se ofrece a la lista de espera de ese servicio.
--
-- Idempotente. No borra datos.

-- ── 1. Cola: tipos nuevos y unicidad solo para los avisos programados ────────────────────────

alter table public.notification_outbox drop constraint if exists notification_outbox_event_type_check;
alter table public.notification_outbox add constraint notification_outbox_event_type_check
  check (event_type in (
    'BOOKED','REMINDER_24H','REMINDER_2H','RESCHEDULED','CANCELLED','FOLLOW_UP','REVIEW_REQUEST',
    'CHANGED','CONFIRM_REQUEST','DAY_OF_REMINDER','WAITLIST_SLOT'
  ));

do $$
declare v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public' and rel.relname = 'notification_outbox' and con.contype = 'u';
  if v_name is not null then
    execute format('alter table public.notification_outbox drop constraint %I', v_name);
  end if;
end $$;

create unique index if not exists notification_outbox_scheduled_uq
  on public.notification_outbox (appointment_id, event_type, channel)
  where event_type in ('REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');

create index if not exists notification_outbox_due_idx
  on public.notification_outbox (scheduled_at)
  where processed_at is null;

-- Marca de confirmación explícita del cliente (respondió "sí, voy").
alter table public.appointments add column if not exists client_confirmed_at timestamptz;

-- ── 2. Encolado con payload enriquecido ─────────────────────────────────────────────────────

-- La versión de 3 argumentos se elimina: con la nueva (4º con default) quedarían ambiguas.
drop function if exists public.enqueue_appointment_event(uuid, text, timestamptz);

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
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found then return; end if;

  select phone, email into v_phone, v_email from public.clients where id = v_appointment.client_id;
  v_channel := case when nullif(btrim(v_phone), '') is not null then 'WHATSAPP'
                    when nullif(btrim(v_email), '') is not null then 'EMAIL'
                    else null end;
  if v_channel is null then return; end if;

  v_scheduled := p_event_type in ('REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');

  -- Los avisos programados son únicos por cita: al mover la cita se reprograman, no se duplican.
  if v_scheduled then
    delete from public.notification_outbox
      where appointment_id = p_appointment_id and event_type = p_event_type and channel = v_channel;
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

-- Programa confirmación (tarde anterior) y recordatorio (mañana del día) en la hora local del negocio.
create or replace function public.schedule_appointment_reminders(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_timezone text;
  v_confirm_hour integer;
  v_reminder_hour integer;
  v_local_day date;
  v_confirm_at timestamptz;
  v_day_of_at timestamptz;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found or v_appointment.status not in ('PENDING','CONFIRMED') then return; end if;

  select b.timezone,
         coalesce((b.settings->>'confirm_hour_day_before')::integer, 18),
         coalesce((b.settings->>'reminder_hour_same_day')::integer, 8)
    into v_timezone, v_confirm_hour, v_reminder_hour
    from public.businesses b where b.id = v_appointment.business_id;
  if v_timezone is null then return; end if;
  v_confirm_hour := least(greatest(v_confirm_hour, 0), 23);
  v_reminder_hour := least(greatest(v_reminder_hour, 0), 23);

  v_local_day := (lower(v_appointment.service_period) at time zone v_timezone)::date;
  v_confirm_at := ((v_local_day - 1) + make_time(v_confirm_hour, 0, 0)) at time zone v_timezone;
  v_day_of_at := (v_local_day + make_time(v_reminder_hour, 0, 0)) at time zone v_timezone;

  -- Nunca después de la propia cita, ni en el pasado.
  if v_confirm_at > now() and v_confirm_at < lower(v_appointment.service_period) then
    perform public.enqueue_appointment_event(p_appointment_id, 'CONFIRM_REQUEST', v_confirm_at);
  end if;
  if v_day_of_at > now() and v_day_of_at < lower(v_appointment.service_period) then
    perform public.enqueue_appointment_event(p_appointment_id, 'DAY_OF_REMINDER', v_day_of_at);
  end if;
end;
$$;

revoke all on function public.schedule_appointment_reminders(uuid) from public, anon;
grant execute on function public.schedule_appointment_reminders(uuid) to service_role;

-- ── 3. Lista de espera: al liberarse un cupo se ofrece a quien lo espera ─────────────────────

create or replace function public.offer_freed_slot_to_waitlist(p_appointment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments;
  v_service_name text;
  v_professional_name text;
  v_entry record;
  v_channel text;
  v_count integer := 0;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found then return 0; end if;

  select name into v_service_name from public.services where id = v_appointment.service_id;
  select display_name into v_professional_name from public.professionals where id = v_appointment.professional_id;

  for v_entry in
    select w.id, w.client_id, c.phone, c.email
    from public.waitlist_entries w
    join public.clients c on c.id = w.client_id
    where w.business_id = v_appointment.business_id
      and w.service_id = v_appointment.service_id
      and w.status = 'WAITING'
      and (w.professional_id is null or w.professional_id = v_appointment.professional_id)
      and (w.preferred_from is null or lower(v_appointment.service_period) >= w.preferred_from)
      and (w.preferred_until is null or lower(v_appointment.service_period) <= w.preferred_until)
    order by w.created_at
    limit 5
  loop
    v_channel := case when nullif(btrim(v_entry.phone), '') is not null then 'WHATSAPP'
                      when nullif(btrim(v_entry.email), '') is not null then 'EMAIL'
                      else null end;
    if v_channel is null then continue; end if;

    insert into public.notification_outbox (business_id, appointment_id, client_id, event_type, channel, payload)
    values (
      v_appointment.business_id, null, v_entry.client_id, 'WAITLIST_SLOT', v_channel,
      jsonb_build_object(
        'slotStart', lower(v_appointment.service_period),
        'serviceId', v_appointment.service_id,
        'serviceName', v_service_name,
        'professionalName', v_professional_name
      )
    );
    update public.waitlist_entries set status = 'CONTACTED', updated_at = now() where id = v_entry.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.offer_freed_slot_to_waitlist(uuid) from public, anon;
grant execute on function public.offer_freed_slot_to_waitlist(uuid) to service_role;

-- ── 4. Trigger: alta, cancelación y reprogramación de avisos ────────────────────────────────

create or replace function public.queue_appointment_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('agen.suppress_notifications', true) = 'on' then return new; end if;

  if tg_op = 'INSERT' then
    perform public.enqueue_appointment_event(new.id, 'BOOKED', now());
    perform public.schedule_appointment_reminders(new.id);
  elsif old.status is distinct from new.status and new.status = 'CANCELLED' then
    delete from public.notification_outbox
      where appointment_id = new.id and processed_at is null
        and event_type in ('REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');
    perform public.enqueue_appointment_event(new.id, 'CHANGED', now(), jsonb_build_object('kind','CANCEL'));
    perform public.offer_freed_slot_to_waitlist(new.id);
  elsif old.service_period is distinct from new.service_period then
    perform public.enqueue_appointment_event(new.id, 'CHANGED', now(), jsonb_build_object(
      'kind','RESCHEDULE',
      'oldStart', lower(old.service_period),
      'newStart', lower(new.service_period)
    ));
    perform public.schedule_appointment_reminders(new.id);
  end if;
  return new;
end;
$$;

-- ── 5. Mutaciones con motivo y autor ────────────────────────────────────────────────────────

create or replace function public.cancel_safe_appointment(
  p_appointment_id uuid,
  p_reason text,
  p_actor text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare v_result public.appointments; v_min_hours integer;
begin
  select * into v_result from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode='P0002', message='Reserva inexistente'; end if;
  if auth.role() <> 'service_role' and not public.is_business_member(v_result.business_id)
    and not exists(select 1 from public.clients where id = v_result.client_id and user_id = auth.uid())
  then raise exception using errcode='42501', message='No autorizado'; end if;
  select coalesce((settings->>'cancellation_hours')::integer, 24) into v_min_hours
    from public.businesses where id = v_result.business_id;
  if auth.role() <> 'service_role' and not public.is_business_member(v_result.business_id)
    and lower(v_result.service_period) - now() < make_interval(hours => v_min_hours)
  then raise exception using errcode='P0001', message='La reserva está dentro del plazo restringido'; end if;

  perform set_config('agen.suppress_notifications', 'on', true);
  update public.appointments set status = 'CANCELLED', updated_at = now()
    where id = p_appointment_id returning * into v_result;

  delete from public.notification_outbox
    where appointment_id = v_result.id and processed_at is null
      and event_type in ('REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');
  perform public.enqueue_appointment_event(v_result.id, 'CHANGED', now(), jsonb_build_object(
    'kind', 'CANCEL',
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'actor', nullif(btrim(coalesce(p_actor, '')), '')
  ));
  perform public.offer_freed_slot_to_waitlist(v_result.id);
  return v_result;
end;
$$;

create or replace function public.cancel_safe_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.cancel_safe_appointment(p_appointment_id, null::text, null::text);
end;
$$;

create or replace function public.reschedule_safe_appointment(
  p_appointment_id uuid,
  p_new_start timestamptz,
  p_reason text,
  p_actor text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.appointments;
  v_slot record;
  v_service public.services;
  v_duration integer;
  v_result public.appointments;
  v_min_hours integer;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode='P0002', message='Reserva inexistente'; end if;
  if auth.role() <> 'service_role' and not public.is_business_member(v_old.business_id)
    and not exists(select 1 from public.clients where id = v_old.client_id and user_id = auth.uid())
  then raise exception using errcode='42501', message='No autorizado'; end if;
  select coalesce((settings->>'cancellation_hours')::integer, 24) into v_min_hours
    from public.businesses where id = v_old.business_id;
  if auth.role() <> 'service_role' and not public.is_business_member(v_old.business_id)
    and lower(v_old.service_period) - now() < make_interval(hours => v_min_hours)
  then raise exception using errcode='P0001', message='La reserva está dentro del plazo restringido'; end if;

  select * into v_service from public.services where id = v_old.service_id;
  select coalesce(custom_duration_minutes, v_service.duration_minutes) into v_duration
    from public.professional_services
    where professional_id = v_old.professional_id and service_id = v_old.service_id and active;

  perform pg_advisory_xact_lock(hashtextextended(v_old.professional_id::text, 0));
  perform set_config('agen.suppress_notifications', 'on', true);
  update public.appointments set status = 'CANCELLED' where id = v_old.id;
  select * into v_slot from public.find_available_professionals(v_old.business_id, v_old.service_id, p_new_start)
    where professional_id = v_old.professional_id;
  if not found then raise exception using errcode='23P01', message='Nuevo horario no disponible'; end if;
  delete from public.appointment_resources where appointment_id = v_old.id;
  update public.appointments set
    period = tstzrange(p_new_start - make_interval(mins => v_service.buffer_before_minutes), p_new_start + make_interval(mins => v_duration + v_service.buffer_after_minutes), '[)'),
    service_period = tstzrange(p_new_start, p_new_start + make_interval(mins => v_duration), '[)'),
    status = v_old.status,
    client_confirmed_at = null,
    updated_at = now()
  where id = v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id, resource_id, period)
  select v_result.id, sr.resource_id, v_result.period
    from public.service_resources sr
    join public.resources r on r.id = sr.resource_id and r.active
   where sr.service_id = v_result.service_id and sr.required;

  perform public.enqueue_appointment_event(v_result.id, 'CHANGED', now(), jsonb_build_object(
    'kind', 'RESCHEDULE',
    'oldStart', lower(v_old.service_period),
    'newStart', lower(v_result.service_period),
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'actor', nullif(btrim(coalesce(p_actor, '')), '')
  ));
  perform public.schedule_appointment_reminders(v_result.id);
  return v_result;
exception when exclusion_violation then
  raise exception using errcode='23P01', message='El horario acaba de ocuparse';
end;
$$;

create or replace function public.reschedule_safe_appointment(p_appointment_id uuid, p_new_start timestamptz)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.reschedule_safe_appointment(p_appointment_id, p_new_start, null::text, null::text);
end;
$$;

create or replace function public.move_safe_appointment(
  p_appointment_id uuid,
  p_new_start timestamptz,
  p_new_professional_id uuid,
  p_reason text,
  p_actor text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.appointments; v_service public.services; v_slot record; v_duration integer;
  v_result public.appointments; v_old_professional text; v_new_professional text;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode='P0002', message='Reserva inexistente'; end if;
  if auth.role() <> 'service_role' and not public.is_business_member(v_old.business_id)
  then raise exception using errcode='42501', message='No autorizado'; end if;
  if v_old.status not in ('PENDING','CONFIRMED')
  then raise exception using errcode='P0001', message='Esta reserva ya no se puede mover'; end if;
  if p_new_start is null or p_new_start <= now()
  then raise exception using errcode='22007', message='La fecha debe estar en el futuro'; end if;
  if p_new_professional_id = v_old.professional_id then
    return public.reschedule_safe_appointment(p_appointment_id, p_new_start, p_reason, p_actor);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(least(v_old.professional_id::text, p_new_professional_id::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_old.professional_id::text, p_new_professional_id::text), 0));
  perform set_config('agen.suppress_notifications', 'on', true);
  -- Quitar temporalmente los recursos de la propia reserva evita que se bloquee a sí misma
  -- cuando solo cambia de profesional a la misma hora. Si algo falla, la sentencia revierte.
  delete from public.appointment_resources where appointment_id = v_old.id;
  select * into v_slot from public.find_available_professionals(v_old.business_id, v_old.service_id, p_new_start)
    where professional_id = p_new_professional_id;
  if not found then raise exception using errcode='23P01', message='El profesional no realiza ese servicio o el horario no está disponible'; end if;
  select * into v_service from public.services where id = v_old.service_id;
  select coalesce(custom_duration_minutes, v_service.duration_minutes) into v_duration
    from public.professional_services
   where professional_id = p_new_professional_id and service_id = v_old.service_id and active;
  update public.appointments set
    professional_id = p_new_professional_id,
    period = tstzrange(p_new_start - make_interval(mins => v_service.buffer_before_minutes), p_new_start + make_interval(mins => v_duration + v_service.buffer_after_minutes), '[)'),
    service_period = tstzrange(p_new_start, p_new_start + make_interval(mins => v_duration), '[)'),
    client_confirmed_at = null,
    updated_at = now()
  where id = v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id, resource_id, period)
    select v_result.id, sr.resource_id, v_result.period
      from public.service_resources sr
      join public.resources r on r.id = sr.resource_id and r.active
     where sr.service_id = v_result.service_id and sr.required;

  select display_name into v_old_professional from public.professionals where id = v_old.professional_id;
  select display_name into v_new_professional from public.professionals where id = p_new_professional_id;
  perform public.enqueue_appointment_event(v_result.id, 'CHANGED', now(), jsonb_build_object(
    'kind', 'MOVE',
    'oldStart', lower(v_old.service_period),
    'newStart', lower(v_result.service_period),
    'oldProfessional', v_old_professional,
    'newProfessional', v_new_professional,
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'actor', nullif(btrim(coalesce(p_actor, '')), '')
  ));
  perform public.schedule_appointment_reminders(v_result.id);
  return v_result;
exception when exclusion_violation then
  raise exception using errcode='23P01', message='El horario acaba de ocuparse';
end;
$$;

create or replace function public.move_safe_appointment(p_appointment_id uuid, p_new_start timestamptz, p_new_professional_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.move_safe_appointment(p_appointment_id, p_new_start, p_new_professional_id, null::text, null::text);
end;
$$;

create or replace function public.resize_safe_appointment(
  p_appointment_id uuid,
  p_duration_minutes integer,
  p_reason text,
  p_actor text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.appointments; v_service public.services; v_business public.businesses;
  v_start timestamptz; v_end timestamptz; v_occupied tstzrange;
  v_local_start timestamp; v_local_end timestamp; v_old_minutes integer;
  v_result public.appointments;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode='P0002', message='Reserva inexistente'; end if;
  if auth.role() <> 'service_role' and not public.is_business_member(v_old.business_id)
  then raise exception using errcode='42501', message='No autorizado'; end if;
  if v_old.status not in ('PENDING','CONFIRMED')
  then raise exception using errcode='P0001', message='Esta reserva ya no se puede modificar'; end if;
  if p_duration_minutes < 5 or p_duration_minutes > 1440
  then raise exception using errcode='22023', message='Duración inválida'; end if;

  select * into v_service from public.services where id = v_old.service_id and business_id = v_old.business_id;
  select * into v_business from public.businesses where id = v_old.business_id;
  v_old_minutes := (extract(epoch from (upper(v_old.service_period) - lower(v_old.service_period))) / 60)::integer;
  v_start := lower(v_old.service_period);
  v_end := v_start + make_interval(mins => p_duration_minutes);
  v_occupied := tstzrange(v_start - make_interval(mins => v_service.buffer_before_minutes), v_end + make_interval(mins => v_service.buffer_after_minutes), '[)');
  v_local_start := v_start at time zone v_business.timezone;
  v_local_end := v_end at time zone v_business.timezone;

  perform pg_advisory_xact_lock(hashtextextended(v_old.professional_id::text, 0));
  perform set_config('agen.suppress_notifications', 'on', true);
  if not exists(
    select 1 from public.professional_availability a
     where a.professional_id = v_old.professional_id and a.active
       and a.weekday = extract(isodow from v_local_start)::smallint
       and (a.valid_from is null or a.valid_from <= v_local_start::date)
       and (a.valid_until is null or a.valid_until >= v_local_start::date)
       and a.starts_at <= v_local_start::time and a.ends_at >= v_local_end::time
  ) then raise exception using errcode='23P01', message='La nueva duración sale del horario disponible'; end if;
  if exists(select 1 from public.schedule_blocks b where b.professional_id = v_old.professional_id and b.period && v_occupied)
    or exists(select 1 from public.appointments a where a.professional_id = v_old.professional_id and a.id <> v_old.id and a.status in ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS') and a.period && v_occupied)
    or exists(select 1 from public.appointment_holds h where h.professional_id = v_old.professional_id and h.expires_at > now() and h.period && v_occupied)
  then raise exception using errcode='23P01', message='La nueva duración invade otro horario'; end if;
  delete from public.appointment_resources where appointment_id = v_old.id;
  if exists(
    select 1 from public.service_resources sr
      join public.appointment_resources ar on ar.resource_id = sr.resource_id
     where sr.service_id = v_old.service_id and sr.required and ar.period && v_occupied
  ) then raise exception using errcode='23P01', message='Un recurso necesario está ocupado'; end if;
  update public.appointments set period = v_occupied, service_period = tstzrange(v_start, v_end, '[)'), updated_at = now()
    where id = v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id, resource_id, period)
    select v_result.id, sr.resource_id, v_result.period
      from public.service_resources sr
      join public.resources r on r.id = sr.resource_id and r.active
     where sr.service_id = v_result.service_id and sr.required;

  perform public.enqueue_appointment_event(v_result.id, 'CHANGED', now(), jsonb_build_object(
    'kind', 'RESIZE',
    'newStart', lower(v_result.service_period),
    'oldMinutes', v_old_minutes,
    'newMinutes', p_duration_minutes,
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'actor', nullif(btrim(coalesce(p_actor, '')), '')
  ));
  perform public.schedule_appointment_reminders(v_result.id);
  return v_result;
exception when exclusion_violation then
  raise exception using errcode='23P01', message='La nueva duración invade otro horario';
end;
$$;

create or replace function public.resize_safe_appointment(p_appointment_id uuid, p_duration_minutes integer)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.resize_safe_appointment(p_appointment_id, p_duration_minutes, null::text, null::text);
end;
$$;

revoke all on function public.cancel_safe_appointment(uuid,text,text) from public, anon;
revoke all on function public.reschedule_safe_appointment(uuid,timestamptz,text,text) from public, anon;
revoke all on function public.move_safe_appointment(uuid,timestamptz,uuid,text,text) from public, anon;
revoke all on function public.resize_safe_appointment(uuid,integer,text,text) from public, anon;
grant execute on function public.cancel_safe_appointment(uuid,text,text) to authenticated, service_role;
grant execute on function public.reschedule_safe_appointment(uuid,timestamptz,text,text) to authenticated, service_role;
grant execute on function public.move_safe_appointment(uuid,timestamptz,uuid,text,text) to authenticated, service_role;
grant execute on function public.resize_safe_appointment(uuid,integer,text,text) to authenticated, service_role;

-- ── 6. Confirmación del cliente ─────────────────────────────────────────────────────────────

create or replace function public.confirm_appointment_by_client(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare v_result public.appointments;
begin
  select * into v_result from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode='P0002', message='Reserva inexistente'; end if;
  if v_result.status not in ('PENDING','CONFIRMED')
  then raise exception using errcode='P0001', message='Esta reserva ya no se puede confirmar'; end if;

  perform set_config('agen.suppress_notifications', 'on', true);
  update public.appointments set status = 'CONFIRMED', client_confirmed_at = now(), updated_at = now()
    where id = p_appointment_id returning * into v_result;
  -- Confirmada por el cliente: el recordatorio de la mañana ya no aporta.
  delete from public.notification_outbox
    where appointment_id = p_appointment_id and processed_at is null
      and event_type in ('CONFIRM_REQUEST','DAY_OF_REMINDER');
  return v_result;
end;
$$;

revoke all on function public.confirm_appointment_by_client(uuid) from public, anon;
grant execute on function public.confirm_appointment_by_client(uuid) to service_role;
