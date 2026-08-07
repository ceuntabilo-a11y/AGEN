-- Bandeja corta de mensajes entrantes del agente: sirve para agrupar los que el cliente
-- manda seguidos y responder una sola vez. Idempotente.
create table if not exists public.agent_inbox (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone text not null,
  message_id text not null,
  content text not null default '',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, phone, message_id)
);

create index if not exists agent_inbox_pending_idx on public.agent_inbox (business_id, phone, created_at) where consumed_at is null;

alter table public.agent_inbox enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_inbox' and policyname = 'agent_inbox_member_read') then
    create policy agent_inbox_member_read on public.agent_inbox
      for select using (public.is_business_member(business_id));
  end if;
end $$;
