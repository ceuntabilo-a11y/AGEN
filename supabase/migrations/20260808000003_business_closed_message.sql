-- Mensaje claro cuando el negocio está cerrado.
--
-- Sin esto, intentar reservar un día cerrado devolvía "El horario acaba de ser reservado por
-- otra persona": el propio manejador de `exclusion_violation` reescribía el 23P01 interno y el
-- usuario no tenía forma de entender que el problema era el horario del negocio.
--
-- Idempotente. No borra datos.

create or replace function public.assert_business_open(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_window record;
  -- Nombres en español fijos: to_char(...,'TMDay') usa el idioma del servidor y salía en inglés.
  v_names text[] := array['los lunes','los martes','los miércoles','los jueves','los viernes','los sábados','los domingos'];
  v_day text;
begin
  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null then return; end if;
  v_local_start := p_start at time zone v_timezone;
  v_local_end := p_end at time zone v_timezone;

  select * into v_window from public.business_day_window(p_business_id, v_local_start::date);
  v_day := v_names[extract(isodow from v_local_start)::integer];

  if not v_window.is_open then
    raise exception using errcode = 'P0001',
      message = 'El negocio no abre ' || v_day || ': elige otro día o abre ese día en Configuración → Horario de atención.';
  end if;
  if v_window.opens_at > v_local_start::time or v_window.closes_at < v_local_end::time then
    raise exception using errcode = 'P0001',
      message = v_day || ' el negocio atiende de ' || to_char(v_window.opens_at, 'HH24:MI')
        || ' a ' || to_char(v_window.closes_at, 'HH24:MI') || ', así que esa hora queda fuera del horario de atención.';
  end if;
end;
$$;

revoke all on function public.assert_business_open(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.assert_business_open(uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.create_safe_appointment(
  p_business_id uuid, p_branch_id uuid, p_client_id uuid, p_professional_id uuid,
  p_service_id uuid, p_desired_start timestamptz,
  p_source public.appointment_source default 'AI_AGENT', p_notes text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_service public.services;
  v_duration integer;
  v_price numeric(12,2);
  v_result public.appointments;
begin
  if p_desired_start is null or p_desired_start <= now() then
    raise exception using errcode = '22007', message = 'La fecha de la reserva debe estar en el futuro';
  end if;

  if auth.role() <> 'service_role'
    and not public.is_business_member(p_business_id)
    and not exists (
      select 1 from public.clients
      where id = p_client_id and business_id = p_business_id and user_id = auth.uid()
    ) then
    raise exception using errcode = '42501', message = 'No autorizado para este negocio';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text, 0));

  select * into v_service
  from public.services
  where id = p_service_id and business_id = p_business_id and active;
  if not found then
    raise exception using errcode = 'P0002', message = 'Servicio inexistente o inactivo';
  end if;

  if not exists (
    select 1 from public.clients where id = p_client_id and business_id = p_business_id
  ) then
    raise exception using errcode = 'P0002', message = 'Cliente no pertenece al negocio';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and business_id = p_business_id and active
  ) then
    raise exception using errcode = 'P0002', message = 'Sucursal inválida';
  end if;

  select coalesce(ps.custom_duration_minutes, v_service.duration_minutes),
         coalesce(ps.custom_price, v_service.price)
  into v_duration, v_price
  from public.professional_services ps
  where ps.professional_id = p_professional_id
    and ps.service_id = p_service_id
    and ps.active;

  -- Horario del negocio antes que nada: así el mensaje explica el motivo real.
  perform public.assert_business_open(
    p_business_id, p_desired_start,
    p_desired_start + make_interval(mins => coalesce(v_duration, v_service.duration_minutes))
  );

  select * into v_slot
  from public.find_available_professionals(p_business_id, p_service_id, p_desired_start)
  where professional_id = p_professional_id;
  if not found then
    raise exception using errcode = '23P01', message = 'Horario no disponible para ese servicio y profesional';
  end if;

  insert into public.appointments (
    business_id, branch_id, client_id, professional_id, service_id,
    period, service_period, status, source, quoted_price, material_cost, notes, created_by
  ) values (
    p_business_id, p_branch_id, p_client_id, p_professional_id, p_service_id,
    tstzrange(
      p_desired_start - make_interval(mins => v_service.buffer_before_minutes),
      p_desired_start + make_interval(mins => v_duration + v_service.buffer_after_minutes),
      '[)'
    ),
    tstzrange(p_desired_start, p_desired_start + make_interval(mins => v_duration), '[)'),
    'PENDING', p_source, v_price, v_service.material_cost, p_notes, auth.uid()
  ) returning * into v_result;

  insert into public.appointment_resources (appointment_id, resource_id, period)
  select v_result.id, sr.resource_id, v_result.period
  from public.service_resources sr
  join public.resources r on r.id = sr.resource_id and r.active
  where sr.service_id = p_service_id and sr.required;

  return v_result;
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'El horario acaba de ser reservado por otra persona';
end;
$$;

-- Reagendar y mover: mismo aviso claro antes de tocar nada.
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

  perform public.assert_business_open(v_old.business_id, p_new_start, p_new_start + make_interval(mins => v_duration));

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
  if p_new_professional_id = v_old.professional_id and p_new_start = lower(v_old.service_period) then
    return v_old;
  end if;
  if p_new_professional_id = v_old.professional_id then
    return public.reschedule_safe_appointment(p_appointment_id, p_new_start, p_reason, p_actor);
  end if;

  select * into v_service from public.services where id = v_old.service_id;
  select coalesce(custom_duration_minutes, v_service.duration_minutes) into v_duration
    from public.professional_services
   where professional_id = p_new_professional_id and service_id = v_old.service_id and active;
  perform public.assert_business_open(v_old.business_id, p_new_start, p_new_start + make_interval(mins => coalesce(v_duration, v_service.duration_minutes)));

  perform pg_advisory_xact_lock(hashtextextended(least(v_old.professional_id::text, p_new_professional_id::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_old.professional_id::text, p_new_professional_id::text), 0));
  perform set_config('agen.suppress_notifications', 'on', true);
  delete from public.appointment_resources where appointment_id = v_old.id;
  select * into v_slot from public.find_available_professionals(v_old.business_id, v_old.service_id, p_new_start)
    where professional_id = p_new_professional_id;
  if not found then raise exception using errcode='23P01', message='El profesional no realiza ese servicio o el horario no está disponible'; end if;
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
