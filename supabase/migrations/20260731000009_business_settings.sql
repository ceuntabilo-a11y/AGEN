alter table public.businesses add column if not exists logo_url text;
alter table public.businesses add column if not exists settings jsonb not null default jsonb_build_object(
  'booking_interval_minutes',15,
  'cancellation_hours',24,
  'deposit_percent',0,
  'allow_client_reschedule',true,
  'allow_client_cancel',true
);
alter table public.businesses add column if not exists agent_settings jsonb not null default jsonb_build_object(
  'enabled',false,
  'tone','friendly',
  'human_handoff_enabled',true
);

create policy businesses_admin_update on public.businesses for update
using (exists(select 1 from public.business_members m where m.business_id=businesses.id and m.user_id=auth.uid() and m.active and m.role in ('OWNER','ADMIN')))
with check (exists(select 1 from public.business_members m where m.business_id=businesses.id and m.user_id=auth.uid() and m.active and m.role in ('OWNER','ADMIN')));
