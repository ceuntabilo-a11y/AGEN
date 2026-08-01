create type public.quote_status as enum ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');
create type public.payment_status as enum ('PENDING', 'PAID', 'REFUNDED', 'FAILED');
create type public.campaign_status as enum ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  name text not null,
  kind text not null,
  color text not null default '#64748b',
  active boolean not null default true,
  unique (business_id, branch_id, name)
);

create table public.service_resources (
  service_id uuid not null references public.services(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  required boolean not null default true,
  primary key (service_id, resource_id)
);

create table public.appointment_resources (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete restrict,
  period tstzrange not null,
  primary key (appointment_id, resource_id)
);

alter table public.appointment_resources add constraint appointment_resource_no_overlap
  exclude using gist (resource_id with =, period with &&);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  professional_id uuid references public.professionals(id) on delete set null,
  status public.quote_status not null default 'DRAFT',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  total numeric(12,2) generated always as (greatest(subtotal - discount + tax, 0)) stored,
  valid_until date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_price) stored
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  status public.payment_status not null default 'PENDING',
  method text,
  external_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  incurred_on date not null default current_date,
  professional_id uuid references public.professionals(id) on delete set null,
  receipt_url text,
  created_at timestamptz not null default now()
);

create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  description text,
  before_url text,
  after_url text not null,
  client_consent boolean not null default false,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  check (not published or client_consent)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'EMAIL', 'PUSH')),
  audience jsonb not null default '{}'::jsonb,
  content text not null,
  status public.campaign_status not null default 'DRAFT',
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.campaign_recipients (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  reason text,
  sent_at timestamptz,
  unique (campaign_id, client_id)
);

alter table public.resources enable row level security;
alter table public.service_resources enable row level security;
alter table public.appointment_resources enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.portfolio_items enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_recipients enable row level security;

create policy resources_member_all on public.resources for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy quotes_member_all on public.quotes for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy payments_member_all on public.payments for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy expenses_member_all on public.expenses for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy portfolio_member_all on public.portfolio_items for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy campaigns_member_all on public.campaigns for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy service_resources_member_all on public.service_resources for all
using (exists (select 1 from public.services s where s.id = service_id and public.is_business_member(s.business_id)))
with check (exists (select 1 from public.services s where s.id = service_id and public.is_business_member(s.business_id)));
create policy appointment_resources_member_all on public.appointment_resources for all
using (exists (select 1 from public.appointments a where a.id = appointment_id and public.is_business_member(a.business_id)))
with check (exists (select 1 from public.appointments a where a.id = appointment_id and public.is_business_member(a.business_id)));
create policy quote_items_member_all on public.quote_items for all
using (exists (select 1 from public.quotes q where q.id = quote_id and public.is_business_member(q.business_id)))
with check (exists (select 1 from public.quotes q where q.id = quote_id and public.is_business_member(q.business_id)));
create policy campaign_recipients_member_all on public.campaign_recipients for all
using (exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_business_member(c.business_id)))
with check (exists (select 1 from public.campaigns c where c.id = campaign_id and public.is_business_member(c.business_id)));

create or replace function public.refresh_quote_subtotal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.quotes
  set subtotal = coalesce((select sum(line_total) from public.quote_items where quote_id = coalesce(new.quote_id, old.quote_id)), 0),
      updated_at = now()
  where id = coalesce(new.quote_id, old.quote_id);
  return coalesce(new, old);
end;
$$;

create trigger quote_items_refresh_total
after insert or update or delete on public.quote_items
for each row execute function public.refresh_quote_subtotal();
