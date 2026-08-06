-- Encuestas de satisfacción (NPS) por negocio. Idempotente y sin tocar nada existente.
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  score smallint not null check (score between 0 and 10),
  comment text,
  source text not null default 'MANUAL' check (source in ('MANUAL', 'CLIENT', 'AI_AGENT')),
  created_at timestamptz not null default now()
);

create index if not exists survey_responses_business_created_idx on public.survey_responses (business_id, created_at desc);
create index if not exists survey_responses_professional_idx on public.survey_responses (professional_id);

alter table public.survey_responses enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'survey_responses' and policyname = 'survey_responses_member_all') then
    create policy survey_responses_member_all on public.survey_responses
      for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
  end if;
end $$;
