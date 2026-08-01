create table public.notification_outbox (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_type text not null check (event_type in ('BOOKED','REMINDER_24H','REMINDER_2H','RESCHEDULED','CANCELLED','FOLLOW_UP','REVIEW_REQUEST')),
  channel text not null check (channel in ('WHATSAPP','EMAIL','PUSH')),
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts smallint not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (appointment_id, event_type, channel)
);

alter table public.notification_outbox enable row level security;
create policy notification_outbox_member_read on public.notification_outbox for select using (public.is_business_member(business_id));

create or replace function public.queue_appointment_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('agen.suppress_notifications', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.notification_outbox (business_id, appointment_id, client_id, event_type, channel, payload)
    values (new.business_id, new.id, new.client_id, 'BOOKED', 'WHATSAPP', jsonb_build_object('appointmentId', new.id));
    insert into public.notification_outbox (business_id, appointment_id, client_id, event_type, channel, payload, scheduled_at)
    values
      (new.business_id, new.id, new.client_id, 'REMINDER_24H', 'WHATSAPP', jsonb_build_object('appointmentId', new.id), lower(new.service_period) - interval '24 hours'),
      (new.business_id, new.id, new.client_id, 'REMINDER_2H', 'WHATSAPP', jsonb_build_object('appointmentId', new.id), lower(new.service_period) - interval '2 hours');
  elsif old.status is distinct from new.status and new.status = 'CANCELLED' then
    delete from public.notification_outbox where appointment_id = new.id and processed_at is null and event_type like 'REMINDER_%';
    insert into public.notification_outbox (business_id, appointment_id, client_id, event_type, channel, payload)
    values (new.business_id, new.id, new.client_id, 'CANCELLED', 'WHATSAPP', jsonb_build_object('appointmentId', new.id)) on conflict do nothing;
  elsif old.service_period is distinct from new.service_period then
    delete from public.notification_outbox where appointment_id = new.id and processed_at is null and event_type like 'REMINDER_%';
    insert into public.notification_outbox (business_id, appointment_id, client_id, event_type, channel, payload)
    values (new.business_id, new.id, new.client_id, 'RESCHEDULED', 'WHATSAPP', jsonb_build_object('appointmentId', new.id)) on conflict do nothing;
    insert into public.notification_outbox (business_id, appointment_id, client_id, event_type, channel, payload, scheduled_at)
    values
      (new.business_id, new.id, new.client_id, 'REMINDER_24H', 'WHATSAPP', jsonb_build_object('appointmentId', new.id), lower(new.service_period) - interval '24 hours'),
      (new.business_id, new.id, new.client_id, 'REMINDER_2H', 'WHATSAPP', jsonb_build_object('appointmentId', new.id), lower(new.service_period) - interval '2 hours');
  end if;
  return new;
end;
$$;

create trigger appointments_queue_notifications
after insert or update of status, service_period on public.appointments
for each row execute function public.queue_appointment_notifications();

create or replace function public.claim_due_notifications(p_limit integer default 50)
returns setof public.notification_outbox language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.notification_outbox n
  set attempts = attempts + 1
  where n.id in (
    select id from public.notification_outbox
    where processed_at is null and scheduled_at <= now() and attempts < 5
    order by scheduled_at for update skip locked limit least(greatest(p_limit, 1), 200)
  ) returning n.*;
end;
$$;

revoke all on function public.claim_due_notifications(integer) from public;
grant execute on function public.claim_due_notifications(integer) to service_role;
