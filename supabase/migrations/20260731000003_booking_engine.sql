create or replace function public.find_available_professionals(
  p_business_id uuid,
  p_service_id uuid,
  p_desired_start timestamptz
)
returns table (
  professional_id uuid,
  professional_name text,
  specialty_id uuid,
  specialty_name text,
  service_id uuid,
  service_name text,
  service_start timestamptz,
  service_end timestamptz,
  quoted_price numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    select
      p.id as professional_id,
      p.display_name,
      sp.id as specialty_id,
      sp.name as specialty_name,
      s.id as service_id,
      s.name as service_name,
      coalesce(ps.custom_duration_minutes, s.duration_minutes) as duration_minutes,
      s.buffer_before_minutes,
      s.buffer_after_minutes,
      coalesce(ps.custom_price, s.price) as price,
      b.timezone
    from public.services s
    join public.specialties sp on sp.id = s.specialty_id and sp.business_id = s.business_id and sp.active
    join public.professional_services ps on ps.service_id = s.id and ps.active
    join public.professionals p on p.id = ps.professional_id and p.business_id = s.business_id and p.active
    join public.businesses b on b.id = s.business_id and b.active
    where s.id = p_service_id and s.business_id = p_business_id and s.active
  ), ranges as (
    select c.*,
      tstzrange(
        p_desired_start - make_interval(mins => c.buffer_before_minutes),
        p_desired_start + make_interval(mins => c.duration_minutes + c.buffer_after_minutes),
        '[)'
      ) as occupied_period,
      p_desired_start + make_interval(mins => c.duration_minutes) as calculated_end,
      (p_desired_start at time zone c.timezone) as local_start,
      ((p_desired_start + make_interval(mins => c.duration_minutes)) at time zone c.timezone) as local_end
    from candidates c
  )
  select
    r.professional_id, r.display_name, r.specialty_id, r.specialty_name,
    r.service_id, r.service_name, p_desired_start, r.calculated_end, r.price
  from ranges r
  where exists (
    select 1
    from public.professional_availability a
    where a.professional_id = r.professional_id
      and a.active
      and a.weekday = extract(isodow from r.local_start)::smallint
      and (a.valid_from is null or a.valid_from <= r.local_start::date)
      and (a.valid_until is null or a.valid_until >= r.local_start::date)
      and a.starts_at <= r.local_start::time
      and a.ends_at >= r.local_end::time
  )
  and not exists (
    select 1 from public.schedule_blocks sb
    where sb.professional_id = r.professional_id and sb.period && r.occupied_period
  )
  and not exists (
    select 1 from public.appointments ap
    where ap.professional_id = r.professional_id
      and ap.status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS')
      and ap.period && r.occupied_period
  )
  and not exists (
    select 1
    from public.service_resources sr
    join public.appointment_resources ar on ar.resource_id = sr.resource_id
    where sr.service_id = r.service_id and sr.required and ar.period && r.occupied_period
  )
  order by r.display_name;
$$;

create or replace function public.create_safe_appointment(
  p_business_id uuid,
  p_branch_id uuid,
  p_client_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_desired_start timestamptz,
  p_source public.appointment_source default 'AI_AGENT',
  p_notes text default null
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
  if auth.role() <> 'service_role'
    and not public.is_business_member(p_business_id)
    and not exists (select 1 from public.clients where id = p_client_id and business_id = p_business_id and user_id = auth.uid()) then
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
    select 1
    from public.clients
    where id = p_client_id and business_id = p_business_id
  ) then
    raise exception using errcode = 'P0002', message = 'Cliente no pertenece al negocio';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and business_id = p_business_id and active
  ) then
    raise exception using errcode = 'P0002', message = 'Sucursal inválida';
  end if;

  select * into v_slot
  from public.find_available_professionals(p_business_id, p_service_id, p_desired_start)
  where professional_id = p_professional_id;

  if not found then
    raise exception using errcode = '23P01', message = 'Horario no disponible para ese servicio y profesional';
  end if;

  select
    coalesce(ps.custom_duration_minutes, v_service.duration_minutes),
    coalesce(ps.custom_price, v_service.price)
  into v_duration, v_price
  from public.professional_services ps
  where ps.professional_id = p_professional_id
    and ps.service_id = p_service_id
    and ps.active;

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

revoke all on function public.create_safe_appointment(uuid, uuid, uuid, uuid, uuid, timestamptz, public.appointment_source, text) from public;
grant execute on function public.create_safe_appointment(uuid, uuid, uuid, uuid, uuid, timestamptz, public.appointment_source, text) to authenticated, service_role;
grant execute on function public.find_available_professionals(uuid, uuid, timestamptz) to authenticated, service_role;

comment on function public.find_available_professionals is 'Devuelve solo profesionales autorizados para el servicio solicitado y realmente disponibles.';
comment on function public.create_safe_appointment is 'Único camino autorizado de reserva. Revalida disponibilidad dentro de la transacción.';
