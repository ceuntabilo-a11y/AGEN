alter table public.businesses add column if not exists maps_url text;
alter table public.campaigns add column if not exists updated_at timestamptz not null default now();
alter table public.clients add column if not exists marketing_unsubscribe_token uuid not null default gen_random_uuid();
create unique index if not exists clients_marketing_unsubscribe_token_idx on public.clients(marketing_unsubscribe_token);
alter table public.notification_outbox add column if not exists claimed_at timestamptz;

update public.businesses
set settings = jsonb_build_object(
  'booking_interval_minutes', 15,
  'cancellation_hours', 24,
  'deposit_percent', 0,
  'allow_client_reschedule', true,
  'allow_client_cancel', true,
  'reminder_hour_same_day', 8,
  'confirm_hour_day_before', 18
) || coalesce(settings, '{}'::jsonb);

with normalized as (
  select id, business_id, regexp_replace(phone, '[^0-9]', '', 'g') as canonical_phone
  from public.clients
  where phone is not null
), safe as (
  select id, canonical_phone
  from normalized n
  where canonical_phone <> ''
    and not exists (
      select 1 from normalized other
      where other.business_id = n.business_id
        and other.canonical_phone = n.canonical_phone
        and other.id <> n.id
    )
)
update public.clients c set phone = safe.canonical_phone, updated_at = now()
from safe where c.id = safe.id and c.phone is distinct from safe.canonical_phone;

create or replace function public.enqueue_appointment_event(
  p_appointment_id uuid,
  p_event_type text,
  p_scheduled_at timestamptz default now()
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
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;
  if not found then return; end if;

  select phone, email into v_phone, v_email from public.clients where id = v_appointment.client_id;
  v_channel := case when nullif(btrim(v_phone), '') is not null then 'WHATSAPP'
                    when nullif(btrim(v_email), '') is not null then 'EMAIL'
                    else null end;
  if v_channel is null then return; end if;

  insert into public.notification_outbox (
    business_id, appointment_id, client_id, event_type, channel, payload, scheduled_at
  ) values (
    v_appointment.business_id,
    v_appointment.id,
    v_appointment.client_id,
    p_event_type,
    v_channel,
    jsonb_build_object('appointmentId', v_appointment.id),
    p_scheduled_at
  )
  on conflict (appointment_id, event_type, channel) do update set
    scheduled_at = excluded.scheduled_at,
    processed_at = null,
    attempts = 0,
    claimed_at = null,
    last_error = null,
    payload = excluded.payload;
end;
$$;

revoke all on function public.enqueue_appointment_event(uuid,text,timestamptz) from public;
grant execute on function public.enqueue_appointment_event(uuid,text,timestamptz) to service_role;

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
    if lower(new.service_period) > now() + interval '24 hours' then
      perform public.enqueue_appointment_event(new.id, 'REMINDER_24H', lower(new.service_period) - interval '24 hours');
    end if;
    if lower(new.service_period) > now() + interval '2 hours' then
      perform public.enqueue_appointment_event(new.id, 'REMINDER_2H', lower(new.service_period) - interval '2 hours');
    end if;
  elsif old.status is distinct from new.status and new.status = 'CANCELLED' then
    delete from public.notification_outbox where appointment_id = new.id and processed_at is null and event_type like 'REMINDER_%';
    perform public.enqueue_appointment_event(new.id, 'CANCELLED', now());
  elsif old.service_period is distinct from new.service_period then
    delete from public.notification_outbox where appointment_id = new.id and processed_at is null and event_type like 'REMINDER_%';
    perform public.enqueue_appointment_event(new.id, 'RESCHEDULED', now());
    if lower(new.service_period) > now() + interval '24 hours' then
      perform public.enqueue_appointment_event(new.id, 'REMINDER_24H', lower(new.service_period) - interval '24 hours');
    end if;
    if lower(new.service_period) > now() + interval '2 hours' then
      perform public.enqueue_appointment_event(new.id, 'REMINDER_2H', lower(new.service_period) - interval '2 hours');
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.find_service_slots(
  p_business_id uuid,
  p_service_id uuid,
  p_from timestamptz,
  p_until timestamptz,
  p_interval_minutes integer default 15,
  p_limit integer default 20
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
language sql stable security definer set search_path = public as $$
  select available.*
  from generate_series(p_from, p_until, make_interval(mins => greatest(p_interval_minutes, 5))) candidate
  cross join lateral public.find_available_professionals(p_business_id, p_service_id, candidate) available
  where p_until > p_from
    and candidate > now()
    and (
      auth.role() = 'service_role'
      or public.is_business_member(p_business_id)
      or exists (
        select 1 from public.clients
        where business_id = p_business_id and user_id = auth.uid()
      )
    )
  order by available.service_start, available.professional_name
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.find_available_professionals(uuid,uuid,timestamptz) from public,authenticated;
grant execute on function public.find_available_professionals(uuid,uuid,timestamptz) to service_role;
revoke all on function public.find_service_slots(uuid,uuid,timestamptz,timestamptz,integer,integer) from public;
grant execute on function public.find_service_slots(uuid,uuid,timestamptz,timestamptz,integer,integer) to authenticated,service_role;

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

  select * into v_slot
  from public.find_available_professionals(p_business_id, p_service_id, p_desired_start)
  where professional_id = p_professional_id;
  if not found then
    raise exception using errcode = '23P01', message = 'Horario no disponible para ese servicio y profesional';
  end if;

  select coalesce(ps.custom_duration_minutes, v_service.duration_minutes),
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

revoke all on function public.create_safe_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,public.appointment_source,text) from public;
grant execute on function public.create_safe_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,public.appointment_source,text) to authenticated,service_role;

create or replace function public.reschedule_safe_appointment(p_appointment_id uuid,p_new_start timestamptz)
returns public.appointments language plpgsql security definer set search_path=public as $$
declare
  v_old public.appointments;
  v_slot record;
  v_service public.services;
  v_duration integer;
  v_result public.appointments;
  v_min_hours integer;
  v_settings jsonb;
  v_is_client boolean;
  v_is_authorized_staff boolean;
begin
  select * into v_old from public.appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='Reserva inexistente'; end if;
  if v_old.status not in ('PENDING','CONFIRMED') then
    raise exception using errcode='P0001',message='Esta reserva ya no admite cambios';
  end if;
  if p_new_start is null or p_new_start <= now() then
    raise exception using errcode='22007',message='La nueva fecha debe estar en el futuro';
  end if;
  select exists(
    select 1 from public.clients where id=v_old.client_id and user_id=auth.uid()
  ) into v_is_client;
  select exists(
    select 1 from public.business_members
    where business_id=v_old.business_id and user_id=auth.uid() and active
      and role in ('OWNER','ADMIN','RECEPTIONIST')
  ) into v_is_authorized_staff;
  if auth.role()<>'service_role' and not v_is_client and not v_is_authorized_staff then
    raise exception using errcode='42501',message='No autorizado';
  end if;
  select coalesce(settings,'{}'::jsonb) into v_settings from public.businesses where id=v_old.business_id;
  v_min_hours := coalesce((v_settings->>'cancellation_hours')::integer,24);
  if auth.role()<>'service_role' and v_is_client and coalesce((v_settings->>'allow_client_reschedule')::boolean,true)=false then
    raise exception using errcode='42501',message='El negocio no permite reagendar desde el portal';
  end if;
  if auth.role()<>'service_role' and v_is_client
    and lower(v_old.service_period)-now()<make_interval(hours=>v_min_hours) then
    raise exception using errcode='P0001',message='La reserva está dentro del plazo restringido';
  end if;
  select * into v_service from public.services where id=v_old.service_id;
  select coalesce(custom_duration_minutes,v_service.duration_minutes) into v_duration from public.professional_services where professional_id=v_old.professional_id and service_id=v_old.service_id and active;
  perform pg_advisory_xact_lock(hashtextextended(v_old.professional_id::text,0));
  perform set_config('agen.suppress_notifications','on',true);
  update public.appointments set status='CANCELLED' where id=v_old.id;
  select * into v_slot from public.find_available_professionals(v_old.business_id,v_old.service_id,p_new_start) where professional_id=v_old.professional_id;
  if not found then raise exception using errcode='23P01',message='Nuevo horario no disponible'; end if;
  delete from public.appointment_resources where appointment_id=v_old.id;
  update public.appointments set
    period=tstzrange(p_new_start-make_interval(mins=>v_service.buffer_before_minutes),p_new_start+make_interval(mins=>v_duration+v_service.buffer_after_minutes),'[)'),
    service_period=tstzrange(p_new_start,p_new_start+make_interval(mins=>v_duration),'[)'),status=v_old.status,updated_at=now()
  where id=v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id,resource_id,period)
  select v_result.id,sr.resource_id,v_result.period from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.active where sr.service_id=v_result.service_id and sr.required;
  perform public.enqueue_appointment_event(v_result.id, 'RESCHEDULED', now());
  if lower(v_result.service_period) > now() + interval '24 hours' then
    perform public.enqueue_appointment_event(v_result.id, 'REMINDER_24H', lower(v_result.service_period)-interval '24 hours');
  end if;
  if lower(v_result.service_period) > now() + interval '2 hours' then
    perform public.enqueue_appointment_event(v_result.id, 'REMINDER_2H', lower(v_result.service_period)-interval '2 hours');
  end if;
  return v_result;
exception when exclusion_violation then
  raise exception using errcode='23P01',message='El horario acaba de ocuparse';
end;
$$;

grant execute on function public.reschedule_safe_appointment(uuid,timestamptz) to authenticated,service_role;

create or replace function public.cancel_safe_appointment(p_appointment_id uuid)
returns public.appointments language plpgsql security definer set search_path=public as $$
declare
  v_result public.appointments;
  v_min_hours integer;
  v_settings jsonb;
  v_is_client boolean;
  v_is_authorized_staff boolean;
begin
  select * into v_result from public.appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='Reserva inexistente'; end if;
  if v_result.status not in ('PENDING','CONFIRMED','CHECKED_IN') then
    raise exception using errcode='P0001',message='Esta reserva ya no admite cancelación';
  end if;
  select exists(
    select 1 from public.clients where id=v_result.client_id and user_id=auth.uid()
  ) into v_is_client;
  select exists(
    select 1 from public.business_members
    where business_id=v_result.business_id and user_id=auth.uid() and active
      and role in ('OWNER','ADMIN','RECEPTIONIST')
  ) into v_is_authorized_staff;
  if auth.role()<>'service_role' and not v_is_client and not v_is_authorized_staff then
    raise exception using errcode='42501',message='No autorizado';
  end if;
  select coalesce(settings,'{}'::jsonb) into v_settings from public.businesses where id=v_result.business_id;
  v_min_hours := coalesce((v_settings->>'cancellation_hours')::integer,24);
  if auth.role()<>'service_role' and v_is_client and coalesce((v_settings->>'allow_client_cancel')::boolean,true)=false then
    raise exception using errcode='42501',message='El negocio no permite cancelar desde el portal';
  end if;
  if auth.role()<>'service_role' and v_is_client
    and lower(v_result.service_period)-now()<make_interval(hours=>v_min_hours) then
    raise exception using errcode='P0001',message='La reserva está dentro del plazo restringido';
  end if;
  update public.appointments set status='CANCELLED',updated_at=now()
  where id=p_appointment_id returning * into v_result;
  return v_result;
end;
$$;

grant execute on function public.cancel_safe_appointment(uuid) to authenticated,service_role;

create or replace function public.claim_due_notifications(p_limit integer default 50)
returns setof public.notification_outbox language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.notification_outbox n
  set attempts = attempts + 1,
      claimed_at = now()
  where n.id in (
    select id from public.notification_outbox
    where processed_at is null
      and scheduled_at <= now()
      and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '10 minutes')
    order by scheduled_at
    for update skip locked
    limit least(greatest(p_limit, 1), 200)
  ) returning n.*;
end;
$$;

revoke all on function public.claim_due_notifications(integer) from public;
grant execute on function public.claim_due_notifications(integer) to service_role;

grant select, update on public.campaigns to authenticated;
