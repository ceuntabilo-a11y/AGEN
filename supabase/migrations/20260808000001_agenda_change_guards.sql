-- Un "cambio" que no cambia nada no es un cambio: no se toca la reserva ni se le manda un
-- aviso al cliente. Pasó de verdad: al guardar la duración sin moverla, el cliente recibió
-- "cambiamos la duración de tu hora" con la fecha vieja, justo cuando lo que se quería
-- cambiar era el día.
--
-- Idempotente. No borra datos.

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

  v_old_minutes := (extract(epoch from (upper(v_old.service_period) - lower(v_old.service_period))) / 60)::integer;
  -- Sin cambio real: se devuelve la reserva tal cual y no se avisa a nadie.
  if p_duration_minutes = v_old_minutes then return v_old; end if;

  select * into v_service from public.services where id = v_old.service_id and business_id = v_old.business_id;
  select * into v_business from public.businesses where id = v_old.business_id;
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
  -- Misma hora: no hay nada que cambiar ni que avisar.
  if p_new_start = lower(v_old.service_period) then return v_old; end if;
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
  -- Ni de profesional ni de hora: nada que avisar.
  if p_new_professional_id = v_old.professional_id and p_new_start = lower(v_old.service_period) then
    return v_old;
  end if;
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

-- Qué días y a qué horas trabaja cada profesional de un servicio: lo usa la agenda para
-- avisar "ese día nadie atiende" en vez de mostrar una lista de horarios vacía y en silencio.
create or replace function public.service_weekday_coverage(
  p_business_id uuid,
  p_service_id uuid,
  p_weekday smallint,
  p_day date
)
returns table (professional_id uuid, professional_name text, works boolean, starts_at time, ends_at time)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         exists (
           select 1 from public.professional_availability a
            where a.professional_id = p.id and a.active and a.weekday = p_weekday
              and (a.valid_from is null or a.valid_from <= p_day)
              and (a.valid_until is null or a.valid_until >= p_day)
         ) as works,
         (select min(a.starts_at) from public.professional_availability a
           where a.professional_id = p.id and a.active and a.weekday = p_weekday
             and (a.valid_from is null or a.valid_from <= p_day)
             and (a.valid_until is null or a.valid_until >= p_day)),
         (select max(a.ends_at) from public.professional_availability a
           where a.professional_id = p.id and a.active and a.weekday = p_weekday
             and (a.valid_from is null or a.valid_from <= p_day)
             and (a.valid_until is null or a.valid_until >= p_day))
    from public.professionals p
    join public.professional_services ps on ps.professional_id = p.id and ps.active
   where p.business_id = p_business_id and p.active and ps.service_id = p_service_id
   order by p.display_name;
$$;

revoke all on function public.service_weekday_coverage(uuid,uuid,smallint,date) from public, anon;
grant execute on function public.service_weekday_coverage(uuid,uuid,smallint,date) to authenticated, service_role;
