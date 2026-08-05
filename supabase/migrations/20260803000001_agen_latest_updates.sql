-- Mejoras generales del roadmap de Agen.
-- Este archivo es idempotente y conserva el dominio de AGEN: negocios de servicios.

alter table public.professionals
  add column if not exists phone text,
  add column if not exists calendar_token uuid,
  add column if not exists calendar_hide_client_names boolean not null default false,
  add column if not exists notification_preferences jsonb not null default '{"BOOKED":true,"CANCELLED":true,"NO_SHOW":true,"RESCHEDULED":true,"DAILY_SUMMARY":false}'::jsonb;

alter table public.business_members
  add column if not exists agent_phone text,
  add column if not exists agent_display_name text;

create unique index if not exists professionals_calendar_token_idx
  on public.professionals(calendar_token) where calendar_token is not null;
create unique index if not exists professionals_business_phone_idx
  on public.professionals(business_id,phone) where phone is not null;
create unique index if not exists business_members_agent_phone_idx
  on public.business_members(business_id,agent_phone) where agent_phone is not null;

create table if not exists public.appointment_holds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  contact_key text,
  period tstzrange not null,
  expires_at timestamptz not null,
  origin text not null default 'AI_AGENT' check (origin in ('AI_AGENT','ADMIN','CLIENT')),
  created_at timestamptz not null default now(),
  check (not isempty(period))
);

create index if not exists appointment_holds_live_idx
  on public.appointment_holds(business_id,professional_id,expires_at);
create index if not exists appointment_holds_period_idx
  on public.appointment_holds using gist(professional_id,period);

create table if not exists public.team_notifications (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  kind text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(recipient_user_id,event_key)
);

create index if not exists team_notifications_recipient_idx
  on public.team_notifications(recipient_user_id,read_at,created_at desc);

create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete set null,
  preferred_from timestamptz,
  preferred_until timestamptz,
  notes text,
  status text not null default 'WAITING' check (status in ('WAITING','CONTACTED','BOOKED','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_business_status_idx
  on public.waitlist_entries(business_id,status,created_at);

create table if not exists public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete cascade,
  reason text not null check (reason in ('NO_SHOW','INACTIVE_CLIENT','UNANSWERED_QUOTE','MANUAL')),
  title text not null,
  due_on date not null default current_date,
  assigned_member_id uuid references public.business_members(id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING','DONE','DISMISSED')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists follow_up_no_show_unique
  on public.follow_up_tasks(appointment_id,reason) where appointment_id is not null;
create unique index if not exists follow_up_quote_unique
  on public.follow_up_tasks(quote_id,reason) where quote_id is not null;
create index if not exists follow_up_business_due_idx
  on public.follow_up_tasks(business_id,status,due_on);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_business_created_idx
  on public.audit_log(business_id,created_at desc);

create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists login_attempts_email_idx on public.login_attempts(email_hash,created_at desc);
create index if not exists login_attempts_ip_idx on public.login_attempts(ip_hash,created_at desc);

alter table public.appointment_holds enable row level security;
alter table public.team_notifications enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.follow_up_tasks enable row level security;
alter table public.audit_log enable row level security;
alter table public.login_attempts enable row level security;

drop policy if exists appointment_holds_member_all on public.appointment_holds;
create policy appointment_holds_member_all on public.appointment_holds for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists team_notifications_recipient_read on public.team_notifications;
create policy team_notifications_recipient_read on public.team_notifications for select
  using (recipient_user_id = auth.uid());
drop policy if exists team_notifications_recipient_update on public.team_notifications;
create policy team_notifications_recipient_update on public.team_notifications for update
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

drop policy if exists waitlist_member_all on public.waitlist_entries;
create policy waitlist_member_all on public.waitlist_entries for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists follow_up_member_all on public.follow_up_tasks;
create policy follow_up_member_all on public.follow_up_tasks for all
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

drop policy if exists audit_log_member_read on public.audit_log;
create policy audit_log_member_read on public.audit_log for select
  using (public.is_business_member(business_id));

-- Nunca se concede acceso del navegador a login_attempts.
revoke all on public.login_attempts from anon,authenticated;

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
language sql stable security definer set search_path = public as $$
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
  where exists (
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

revoke all on function public.find_available_professionals(uuid,uuid,timestamptz) from public,authenticated;
grant execute on function public.find_available_professionals(uuid,uuid,timestamptz) to service_role;

create or replace function public.create_slot_hold(
  p_business_id uuid,
  p_professional_id uuid,
  p_service_id uuid,
  p_desired_start timestamptz,
  p_client_id uuid default null,
  p_contact_key text default null,
  p_minutes integer default 15,
  p_origin text default 'AI_AGENT'
)
returns public.appointment_holds
language plpgsql security definer set search_path=public as $$
declare v_slot record; v_service public.services; v_duration integer; v_result public.appointment_holds;
begin
  if auth.role()<>'service_role' and not public.is_business_member(p_business_id) then
    raise exception using errcode='42501',message='No autorizado';
  end if;
  if p_desired_start is null or p_desired_start<=now() then
    raise exception using errcode='22007',message='La fecha debe estar en el futuro';
  end if;
  if p_client_id is not null and not exists (
    select 1 from public.clients where id=p_client_id and business_id=p_business_id
  ) then
    raise exception using errcode='P0002',message='Cliente no pertenece al negocio';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_professional_id::text,0));
  delete from public.appointment_holds where expires_at<=now();
  select * into v_slot from public.find_available_professionals(p_business_id,p_service_id,p_desired_start)
    where professional_id=p_professional_id;
  if not found then raise exception using errcode='23P01',message='Horario no disponible'; end if;
  select * into v_service from public.services where id=p_service_id and business_id=p_business_id and active;
  select coalesce(custom_duration_minutes,v_service.duration_minutes) into v_duration
    from public.professional_services where professional_id=p_professional_id and service_id=p_service_id and active;
  insert into public.appointment_holds(business_id,professional_id,service_id,client_id,contact_key,period,expires_at,origin)
  values(p_business_id,p_professional_id,p_service_id,p_client_id,nullif(btrim(p_contact_key),''),
    tstzrange(p_desired_start-make_interval(mins=>v_service.buffer_before_minutes),
      p_desired_start+make_interval(mins=>v_duration+v_service.buffer_after_minutes),'[)'),
    now()+make_interval(mins=>least(greatest(coalesce(p_minutes,15),5),30)),p_origin)
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.create_slot_hold(uuid,uuid,uuid,timestamptz,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_slot_hold(uuid,uuid,uuid,timestamptz,uuid,text,integer,text) to service_role;

create or replace function public.confirm_held_appointment(
  p_hold_id uuid,
  p_client_id uuid,
  p_branch_id uuid default null,
  p_notes text default null
)
returns public.appointments
language plpgsql security definer set search_path=public as $$
declare v_hold public.appointment_holds; v_start timestamptz; v_result public.appointments;
begin
  select * into v_hold from public.appointment_holds where id=p_hold_id for update;
  if not found or v_hold.expires_at<=now() then
    raise exception using errcode='23P01',message='El apartado venció; busca horarios nuevamente';
  end if;
  if v_hold.client_id is not null and v_hold.client_id<>p_client_id then
    raise exception using errcode='42501',message='El apartado pertenece a otro cliente';
  end if;
  v_start:=lower(v_hold.period);
  select v_start+make_interval(mins=>s.buffer_before_minutes) into v_start
    from public.services s where s.id=v_hold.service_id;
  delete from public.appointment_holds where id=v_hold.id;
  select * into v_result from public.create_safe_appointment(v_hold.business_id,p_branch_id,p_client_id,
    v_hold.professional_id,v_hold.service_id,v_start,'AI_AGENT',p_notes);
  return v_result;
end;
$$;

revoke all on function public.confirm_held_appointment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_held_appointment(uuid,uuid,uuid,text) to service_role;

create or replace function public.queue_team_appointment_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_kind text; v_title text; v_body text; v_event_key text;
begin
  if tg_op='INSERT' then
    v_kind:='BOOKED'; v_title:='Nueva reserva'; v_body:='Se creó una reserva nueva.';
  elsif old.service_period is distinct from new.service_period then
    v_kind:='RESCHEDULED'; v_title:='Reserva reagendada'; v_body:='Cambió la fecha u hora de una reserva.';
  elsif old.status is distinct from new.status and new.status='CANCELLED' then
    v_kind:='CANCELLED'; v_title:='Reserva cancelada'; v_body:='Una reserva fue cancelada.';
  elsif old.status is distinct from new.status and new.status='NO_SHOW' then
    v_kind:='NO_SHOW'; v_title:='Cliente ausente'; v_body:='Un cliente no asistió a su reserva.';
  else return new;
  end if;
  if v_kind='CANCELLED' and current_setting('agen.suppress_notifications',true)='on' then
    return new;
  end if;
  v_event_key:=new.id::text||':'||v_kind||':'||new.updated_at::text;
  insert into public.team_notifications(business_id,recipient_user_id,event_key,kind,title,body,payload)
  select new.business_id,bm.user_id,v_event_key||':'||bm.user_id::text,v_kind,v_title,v_body,
    jsonb_build_object('appointmentId',new.id,'professionalId',new.professional_id,'status',new.status)
  from public.business_members bm
  where bm.business_id=new.business_id and bm.active
    and (bm.role in ('OWNER','ADMIN','RECEPTIONIST') or exists (
      select 1 from public.professionals p where p.id=new.professional_id and p.member_id=bm.id
        and coalesce((p.notification_preferences->>v_kind)::boolean,true)
    ))
  on conflict(recipient_user_id,event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists appointments_team_notifications on public.appointments;
create trigger appointments_team_notifications after insert or update on public.appointments
for each row execute function public.queue_team_appointment_notification();

create or replace function public.audit_appointment_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.audit_log(business_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(new.business_id,auth.uid(),case when tg_op='INSERT' then 'APPOINTMENT_CREATED' else 'APPOINTMENT_UPDATED' end,
    'appointments',new.id::text,jsonb_build_object('status',new.status,'source',new.source));
  return new;
end;
$$;

drop trigger if exists appointments_audit on public.appointments;
create trigger appointments_audit after insert or update on public.appointments
for each row execute function public.audit_appointment_change();

create or replace function public.generate_follow_up_tasks(p_business_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0; v_rows integer:=0;
begin
  if auth.role()<>'service_role' and not public.is_business_member(p_business_id) then
    raise exception using errcode='42501',message='No autorizado';
  end if;
  insert into public.follow_up_tasks(business_id,client_id,appointment_id,reason,title,due_on)
  select a.business_id,a.client_id,a.id,'NO_SHOW','Contactar después de una ausencia',current_date
  from public.appointments a
  where a.business_id=p_business_id and a.status='NO_SHOW'
  on conflict do nothing;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;

  insert into public.follow_up_tasks(business_id,client_id,quote_id,reason,title,due_on)
  select q.business_id,q.client_id,q.id,'UNANSWERED_QUOTE','Dar seguimiento al presupuesto',current_date
  from public.quotes q
  where q.business_id=p_business_id and q.status='SENT' and q.created_at<now()-interval '7 days'
  on conflict do nothing;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;

  insert into public.follow_up_tasks(business_id,client_id,appointment_id,reason,title,due_on)
  select p_business_id,c.id,last_visit.id,'INACTIVE_CLIENT','Volver a contactar a cliente inactivo',current_date
  from public.clients c
  cross join lateral (
    select a.id,upper(a.service_period) as finished_at
    from public.appointments a
    where a.client_id=c.id and a.business_id=p_business_id and a.status='COMPLETED'
    order by upper(a.service_period) desc limit 1
  ) last_visit
  where c.business_id=p_business_id
    and last_visit.finished_at<now()-interval '180 days'
    and not exists (
      select 1 from public.appointments future
      where future.client_id=c.id and future.business_id=p_business_id
        and future.status in ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS')
        and lower(future.service_period)>now()
    )
  on conflict do nothing;
  get diagnostics v_rows=row_count; v_count:=v_count+v_rows;
  return v_count;
end;
$$;

revoke all on function public.generate_follow_up_tasks(uuid) from public,anon;
grant execute on function public.generate_follow_up_tasks(uuid) to authenticated,service_role;

create or replace function public.move_safe_appointment(
  p_appointment_id uuid,
  p_new_start timestamptz,
  p_new_professional_id uuid
)
returns public.appointments language plpgsql security definer set search_path=public as $$
declare v_old public.appointments; v_service public.services; v_slot record; v_duration integer; v_result public.appointments;
begin
  select * into v_old from public.appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='Reserva inexistente'; end if;
  if auth.role()<>'service_role' and not public.is_business_member(v_old.business_id) then raise exception using errcode='42501',message='No autorizado'; end if;
  if v_old.status not in ('PENDING','CONFIRMED') then raise exception using errcode='P0001',message='Esta reserva ya no se puede mover'; end if;
  if p_new_start is null or p_new_start<=now() then raise exception using errcode='22007',message='La fecha debe estar en el futuro'; end if;
  if p_new_professional_id=v_old.professional_id then
    return public.reschedule_safe_appointment(p_appointment_id,p_new_start);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(least(v_old.professional_id::text,p_new_professional_id::text),0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_old.professional_id::text,p_new_professional_id::text),0));
  -- Quitar temporalmente los recursos de la propia reserva evita que se bloquee a sí misma
  -- cuando solo cambia de profesional a la misma hora. Si algo falla, la sentencia revierte.
  delete from public.appointment_resources where appointment_id=v_old.id;
  select * into v_slot from public.find_available_professionals(v_old.business_id,v_old.service_id,p_new_start) where professional_id=p_new_professional_id;
  if not found then raise exception using errcode='23P01',message='El profesional no realiza ese servicio o el horario no está disponible'; end if;
  select * into v_service from public.services where id=v_old.service_id;
  select coalesce(custom_duration_minutes,v_service.duration_minutes) into v_duration from public.professional_services
    where professional_id=p_new_professional_id and service_id=v_old.service_id and active;
  update public.appointments set professional_id=p_new_professional_id,
    period=tstzrange(p_new_start-make_interval(mins=>v_service.buffer_before_minutes),p_new_start+make_interval(mins=>v_duration+v_service.buffer_after_minutes),'[)'),
    service_period=tstzrange(p_new_start,p_new_start+make_interval(mins=>v_duration),'[)'),updated_at=now()
  where id=v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id,resource_id,period)
    select v_result.id,sr.resource_id,v_result.period from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.active where sr.service_id=v_result.service_id and sr.required;
  return v_result;
exception when exclusion_violation then raise exception using errcode='23P01',message='El horario acaba de ocuparse';
end;
$$;

revoke all on function public.move_safe_appointment(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.move_safe_appointment(uuid,timestamptz,uuid) to authenticated,service_role;

create or replace function public.resize_safe_appointment(
  p_appointment_id uuid,
  p_duration_minutes integer
)
returns public.appointments language plpgsql security definer set search_path=public as $$
declare
  v_old public.appointments; v_service public.services; v_business public.businesses;
  v_start timestamptz; v_end timestamptz; v_occupied tstzrange; v_local_start timestamp; v_local_end timestamp;
  v_result public.appointments;
begin
  select * into v_old from public.appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='Reserva inexistente'; end if;
  if auth.role()<>'service_role' and not public.is_business_member(v_old.business_id) then raise exception using errcode='42501',message='No autorizado'; end if;
  if v_old.status not in ('PENDING','CONFIRMED') then raise exception using errcode='P0001',message='Esta reserva ya no se puede modificar'; end if;
  if p_duration_minutes<5 or p_duration_minutes>1440 then raise exception using errcode='22023',message='Duración inválida'; end if;
  select * into v_service from public.services where id=v_old.service_id and business_id=v_old.business_id;
  select * into v_business from public.businesses where id=v_old.business_id;
  v_start:=lower(v_old.service_period); v_end:=v_start+make_interval(mins=>p_duration_minutes);
  v_occupied:=tstzrange(v_start-make_interval(mins=>v_service.buffer_before_minutes),v_end+make_interval(mins=>v_service.buffer_after_minutes),'[)');
  v_local_start:=v_start at time zone v_business.timezone; v_local_end:=v_end at time zone v_business.timezone;
  perform pg_advisory_xact_lock(hashtextextended(v_old.professional_id::text,0));
  if not exists(
    select 1 from public.professional_availability a where a.professional_id=v_old.professional_id and a.active
      and a.weekday=extract(isodow from v_local_start)::smallint
      and (a.valid_from is null or a.valid_from<=v_local_start::date) and (a.valid_until is null or a.valid_until>=v_local_start::date)
      and a.starts_at<=v_local_start::time and a.ends_at>=v_local_end::time
  ) then raise exception using errcode='23P01',message='La nueva duración sale del horario disponible'; end if;
  if exists(select 1 from public.schedule_blocks b where b.professional_id=v_old.professional_id and b.period&&v_occupied)
    or exists(select 1 from public.appointments a where a.professional_id=v_old.professional_id and a.id<>v_old.id and a.status in ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS') and a.period&&v_occupied)
    or exists(select 1 from public.appointment_holds h where h.professional_id=v_old.professional_id and h.expires_at>now() and h.period&&v_occupied)
  then raise exception using errcode='23P01',message='La nueva duración invade otro horario'; end if;
  delete from public.appointment_resources where appointment_id=v_old.id;
  if exists(
    select 1 from public.service_resources sr join public.appointment_resources ar on ar.resource_id=sr.resource_id
    where sr.service_id=v_old.service_id and sr.required and ar.period&&v_occupied
  ) then raise exception using errcode='23P01',message='Un recurso necesario está ocupado'; end if;
  update public.appointments set period=v_occupied,service_period=tstzrange(v_start,v_end,'[)'),updated_at=now()
    where id=v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id,resource_id,period)
    select v_result.id,sr.resource_id,v_result.period from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.active where sr.service_id=v_result.service_id and sr.required;
  return v_result;
exception when exclusion_violation then raise exception using errcode='23P01',message='La nueva duración invade otro horario';
end;
$$;

revoke all on function public.resize_safe_appointment(uuid,integer) from public,anon;
grant execute on function public.resize_safe_appointment(uuid,integer) to authenticated,service_role;

-- Cierra también las funciones de la migración anterior, que son SECURITY DEFINER.
revoke all on function public.reschedule_safe_appointment(uuid,timestamptz) from public,anon;
revoke all on function public.cancel_safe_appointment(uuid) from public,anon;
grant execute on function public.reschedule_safe_appointment(uuid,timestamptz) to authenticated,service_role;
grant execute on function public.cancel_safe_appointment(uuid) to authenticated,service_role;
