create table public.communication_consents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  channel text not null check (channel in ('WHATSAPP','INSTAGRAM','MESSENGER','EMAIL','PUSH','SMS')),
  purpose text not null check (purpose in ('TRANSACTIONAL','MARKETING')),
  granted boolean not null,
  source text not null default 'ADMIN' check (source in ('ADMIN','CLIENT','IMPORT','AI_AGENT','FORM')),
  proof jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (client_id,channel,purpose)
);
alter table public.communication_consents enable row level security;
create policy communication_consents_member_all on public.communication_consents for all
using (exists(select 1 from public.clients c where c.id=client_id and public.is_business_member(c.business_id)))
with check (exists(select 1 from public.clients c where c.id=client_id and public.is_business_member(c.business_id)));
create policy communication_consents_client_read on public.communication_consents for select
using (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()));
create policy communication_consents_client_update on public.communication_consents for update
using (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()))
with check (exists(select 1 from public.clients c where c.id=client_id and c.user_id=auth.uid()));

insert into public.communication_consents(client_id,channel,purpose,granted,source)
select id,'WHATSAPP','MARKETING',true,'IMPORT' from public.clients where marketing_opt_in
on conflict do nothing;
insert into public.communication_consents(client_id,channel,purpose,granted,source)
select id,'EMAIL','MARKETING',true,'IMPORT' from public.clients where marketing_opt_in and email is not null
on conflict do nothing;
