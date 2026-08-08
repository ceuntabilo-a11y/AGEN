-- Horario del negocio: manda sobre todo lo demás.
--
-- Hasta ahora solo existía el horario de cada profesional, así que si los datos decían que
-- alguien atendía el domingo, la agenda ofrecía el domingo aunque el negocio estuviera cerrado.
-- Ahora el negocio define, día por día, si abre y entre qué horas; el horario de cada
-- profesional solo vale dentro de esa ventana.
--
-- Formato en businesses.settings:
--   "business_hours": [{"day":1,"enabled":true,"start":"09:00","end":"19:00"}, ...]  (1=lunes … 7=domingo)
-- Si la clave no existe, el negocio se considera abierto toda la semana: los negocios que
-- todavía no configuraron su horario siguen funcionando igual que antes.
--
-- Idempotente. No borra datos.

create or replace function public.business_day_window(p_business_id uuid, p_local_date date)
returns table (is_open boolean, opens_at time, closes_at time)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hours jsonb;
  v_weekday integer := extract(isodow from p_local_date)::integer;
  v_entry jsonb;
begin
  select settings->'business_hours' into v_hours from public.businesses where id = p_business_id;

  -- Sin horario configurado: abierto siempre (compatibilidad con negocios ya existentes).
  if v_hours is null or jsonb_typeof(v_hours) <> 'array' or jsonb_array_length(v_hours) = 0 then
    return query select true, '00:00'::time, '23:59:59'::time;
    return;
  end if;

  select value into v_entry
  from jsonb_array_elements(v_hours) value
  where (value->>'day')::integer = v_weekday
  limit 1;

  -- Día que no aparece en la lista = cerrado.
  if v_entry is null or coalesce((v_entry->>'enabled')::boolean, true) = false then
    return query select false, null::time, null::time;
    return;
  end if;

  return query select true,
    coalesce(nullif(v_entry->>'start', ''), '00:00')::time,
    coalesce(nullif(v_entry->>'end', ''), '23:59:59')::time;
end;
$$;

revoke all on function public.business_day_window(uuid, date) from public, anon;
grant execute on function public.business_day_window(uuid, date) to authenticated, service_role;

-- Única puerta de disponibilidad: aquí pasan la agenda, el agente, el portal del cliente y
-- todas las funciones *_safe_appointment. Se le añade la ventana del negocio.
create or replace function public.find_available_professionals(
  p_business_id uuid,
  p_service_id uuid,
  p_desired_start timestamptz
)
returns table (
  professional_id uuid, professional_name text, specialty_id uuid, specialty_name text,
  service_id uuid, service_name text, service_start timestamptz, service_end timestamptz,
  quoted_price numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select p.id professional_id,p.display_name,sp.id specialty_id,sp.name specialty_name,
      s.id service_id,s.name service_name,
      coalesce(ps.custom_duration_minutes,s.duration_minutes) duration_minutes,
      s.buffer_before_minutes,s.buffer_after_minutes,coalesce(ps.custom_price,s.price) price,b.timezone
    from public.services s
    join public.specialties sp on sp.id=s.specialty_id and sp.business_id=s.business_id and sp.active
    join public.professional_services ps on ps.service_id=s.id and ps.active
    join public.professionals p on p.id=ps.professional_id and p.business_id=s.business_id and p.active
    join public.businesses b on b.id=s.business_id and b.active
    where s.id=p_service_id and s.business_id=p_business_id and s.active
  ), ranges as (
    select c.*,
      tstzrange(p_desired_start-make_interval(mins=>c.buffer_before_minutes),
        p_desired_start+make_interval(mins=>c.duration_minutes+c.buffer_after_minutes),'[)') occupied_period,
      p_desired_start+make_interval(mins=>c.duration_minutes) calculated_end,
      p_desired_start at time zone c.timezone local_start,
      (p_desired_start+make_interval(mins=>c.duration_minutes)) at time zone c.timezone local_end
    from candidates c
  )
  select r.professional_id,r.display_name,r.specialty_id,r.specialty_name,
    r.service_id,r.service_name,p_desired_start,r.calculated_end,r.price
  from ranges r
  -- El negocio manda: fuera de su horario no se atiende, tenga o no el profesional ese día.
  where exists (
    select 1 from public.business_day_window(p_business_id, r.local_start::date) w
    where w.is_open and w.opens_at <= r.local_start::time and w.closes_at >= r.local_end::time
  )
  and exists (
    select 1 from public.professional_availability a
    where a.professional_id=r.professional_id and a.active
      and a.weekday=extract(isodow from r.local_start)::smallint
      and (a.valid_from is null or a.valid_from<=r.local_start::date)
      and (a.valid_until is null or a.valid_until>=r.local_start::date)
      and a.starts_at<=r.local_start::time and a.ends_at>=r.local_end::time
  )
  and not exists (select 1 from public.schedule_blocks sb where sb.professional_id=r.professional_id and sb.period&&r.occupied_period)
  and not exists (
    select 1 from public.appointments ap where ap.professional_id=r.professional_id
      and ap.status in ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS') and ap.period&&r.occupied_period
  )
  and not exists (
    select 1 from public.appointment_holds h where h.professional_id=r.professional_id
      and h.expires_at>now() and h.period&&r.occupied_period
  )
  and not exists (
    select 1 from public.service_resources sr
    join public.appointment_resources ar on ar.resource_id=sr.resource_id
    where sr.service_id=r.service_id and sr.required and ar.period&&r.occupied_period
  )
  order by r.display_name;
$$;

-- Alargar una reserva tampoco puede pasarse de la hora de cierre del negocio.
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
    select 1 from public.business_day_window(v_old.business_id, v_local_start::date) w
    where w.is_open and w.opens_at <= v_local_start::time and w.closes_at >= v_local_end::time
  ) then raise exception using errcode='23P01', message='La nueva duración se pasa del horario de atención del negocio'; end if;
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

-- La cobertura por día que consulta la agenda ahora también respeta el cierre del negocio:
-- si el negocio cierra ese día, ningún profesional "trabaja".
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
         (select w.is_open from public.business_day_window(p_business_id, p_day) w)
           and exists (
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
