create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.member_role as enum ('OWNER', 'ADMIN', 'PROFESSIONAL', 'RECEPTIONIST');
create type public.appointment_status as enum ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
create type public.appointment_source as enum ('ADMIN', 'PROFESSIONAL', 'CLIENT', 'AI_AGENT', 'IMPORT');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'America/Santiago',
  currency text not null default 'CLP',
  phone text,
  email text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  timezone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  color text not null default '#5b3df5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, slug)
);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid references public.business_members(id) on delete set null,
  display_name text not null,
  bio text,
  color text not null default '#5b3df5' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  commission_percent numeric(5,2) not null default 0 check (commission_percent between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.professional_specialties (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  specialty_id uuid not null references public.specialties(id) on delete cascade,
  primary key (professional_id, specialty_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  specialty_id uuid not null references public.specialties(id) on delete restrict,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 240),
  price numeric(12,2) not null default 0 check (price >= 0),
  material_cost numeric(12,2) not null default 0 check (material_cost >= 0),
  deposit_amount numeric(12,2) not null default 0 check (deposit_amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, specialty_id, name)
);

create table public.professional_services (
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  custom_duration_minutes integer check (custom_duration_minutes between 5 and 1440),
  custom_price numeric(12,2) check (custom_price >= 0),
  active boolean not null default true,
  primary key (professional_id, service_id)
);

create table public.professional_availability (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  valid_from date,
  valid_until date,
  active boolean not null default true,
  check (starts_at < ends_at)
);

create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  period tstzrange not null,
  reason text,
  created_at timestamptz not null default now(),
  check (not isempty(period))
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  phone text,
  email text,
  birthday date,
  notes text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_memory (
  client_id uuid primary key references public.clients(id) on delete cascade,
  preferred_professional_id uuid references public.professionals(id) on delete set null,
  preferred_service_id uuid references public.services(id) on delete set null,
  preferences jsonb not null default '{}'::jsonb,
  known_facts jsonb not null default '{}'::jsonb,
  conversation_summary text,
  last_intent text,
  last_interaction_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  channel text not null check (channel in ('WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'WEB', 'EMAIL')),
  external_id text,
  status text not null default 'OPEN' check (status in ('OPEN', 'HUMAN', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  sender text not null check (sender in ('CLIENT', 'AI', 'HUMAN', 'SYSTEM')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete restrict,
  professional_id uuid not null references public.professionals(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  period tstzrange not null,
  service_period tstzrange not null,
  status public.appointment_status not null default 'PENDING',
  source public.appointment_source not null default 'ADMIN',
  quoted_price numeric(12,2) not null check (quoted_price >= 0),
  material_cost numeric(12,2) not null default 0 check (material_cost >= 0),
  deposit_paid numeric(12,2) not null default 0 check (deposit_paid >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not isempty(period)),
  check (not isempty(service_period))
);

alter table public.appointments add constraint appointments_professional_no_overlap
  exclude using gist (professional_id with =, period with &&)
  where (status in ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'));

create index appointments_business_period_idx on public.appointments using gist (business_id, period);
create index appointments_professional_period_idx on public.appointments using gist (professional_id, period);
create index blocks_professional_period_idx on public.schedule_blocks using gist (professional_id, period);
create index services_specialty_idx on public.services (business_id, specialty_id) where active;
create unique index clients_phone_unique_idx on public.clients (business_id, phone) where phone is not null;

create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members
    where business_id = target_business_id and user_id = auth.uid() and active
  );
$$;

alter table public.businesses enable row level security;
alter table public.branches enable row level security;
alter table public.business_members enable row level security;
alter table public.specialties enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_specialties enable row level security;
alter table public.services enable row level security;
alter table public.professional_services enable row level security;
alter table public.professional_availability enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.clients enable row level security;
alter table public.client_memory enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.appointments enable row level security;

create policy businesses_member_read on public.businesses for select using (public.is_business_member(id));
create policy branches_member_all on public.branches for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy members_same_business_read on public.business_members for select using (public.is_business_member(business_id));
create policy specialties_member_all on public.specialties for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy professionals_member_all on public.professionals for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy services_member_all on public.services for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy blocks_member_all on public.schedule_blocks for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy clients_member_all on public.clients for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy conversations_member_all on public.conversations for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy appointments_member_all on public.appointments for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy professional_specialties_member_all on public.professional_specialties for all
using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_business_member(p.business_id)))
with check (exists (select 1 from public.professionals p where p.id = professional_id and public.is_business_member(p.business_id)));
create policy professional_services_member_all on public.professional_services for all
using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_business_member(p.business_id)))
with check (exists (select 1 from public.professionals p where p.id = professional_id and public.is_business_member(p.business_id)));
create policy availability_member_all on public.professional_availability for all
using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_business_member(p.business_id)))
with check (exists (select 1 from public.professionals p where p.id = professional_id and public.is_business_member(p.business_id)));
create policy memory_member_all on public.client_memory for all
using (exists (select 1 from public.clients c where c.id = client_id and public.is_business_member(c.business_id)))
with check (exists (select 1 from public.clients c where c.id = client_id and public.is_business_member(c.business_id)));
create policy messages_member_all on public.messages for all
using (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_business_member(c.business_id)))
with check (exists (select 1 from public.conversations c where c.id = conversation_id and public.is_business_member(c.business_id)));

comment on table public.professional_services is 'Lista autorizada de servicios por profesional. El agente nunca debe inferir esta relación.';
comment on column public.appointments.period is 'Incluye buffers y se usa para impedir solapamientos.';
comment on column public.appointments.service_period is 'Tiempo visible de atención sin buffers.';
