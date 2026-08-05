-- Capa de plataforma (super admin), canales de mensajería, capacidades multimedia del
-- agente y campo de imagen en campañas. Idempotente. Conserva el dominio Agen: negocios
-- de servicios para todo tipo de rubro, sin módulos clínicos.

create table if not exists public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id)
);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.platform_admins where user_id = auth.uid() and active);
$$;

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_professionals integer,
  price numeric(12,2) not null default 0,
  currency text not null default 'CLP',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_addons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('IMAGE_ANALYSIS','VOICE_NOTES','VOICE_CALLS')),
  name text not null,
  price numeric(12,2) not null default 0,
  currency text not null default 'CLP',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plan_addons(code,name,price) values
  ('IMAGE_ANALYSIS','Análisis de imágenes',0),
  ('VOICE_NOTES','Notas de voz',0),
  ('VOICE_CALLS','Llamadas de voz',0)
on conflict (code) do nothing;

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.businesses
  add column if not exists plan_id uuid references public.membership_plans(id) on delete set null,
  add column if not exists suspended_at timestamptz,
  add column if not exists whatsapp_provider text check (whatsapp_provider in ('EVOLUTION','META','DIALOG360')),
  add column if not exists whatsapp_instance text,
  add column if not exists whatsapp_phone_id text,
  add column if not exists whatsapp_token text,
  add column if not exists whatsapp_360_api_key text,
  add column if not exists openai_api_key text,
  add column if not exists dashscope_api_key text,
  add column if not exists dashscope_endpoint text,
  add column if not exists feature_image boolean not null default false,
  add column if not exists feature_voice boolean not null default false,
  add column if not exists feature_calls boolean not null default false;

alter table public.businesses
  alter column agent_settings set default jsonb_build_object(
    'enabled',false,
    'tone','friendly',
    'human_handoff_enabled',true,
    'voice',jsonb_build_object(
      'enabled',false,'gender','female','style','warm','speed',1.0,
      'accent','neutral','emotion','neutral','language','es'
    ),
    'behavior',jsonb_build_object(
      'respond_voice',false,'respond_voice_only_if_voice',true,
      'also_send_text',true,'max_duration_seconds',30
    ),
    'prompt_extra',''
  );

alter table public.campaigns add column if not exists image_url text;

alter table public.platform_admins enable row level security;
alter table public.membership_plans enable row level security;
alter table public.plan_addons enable row level security;
alter table public.platform_settings enable row level security;

create policy platform_admins_read on public.platform_admins for select using (public.is_platform_admin());
create policy platform_admins_write on public.platform_admins for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy membership_plans_public_read on public.membership_plans for select using (true);
create policy membership_plans_admin_write on public.membership_plans for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy plan_addons_public_read on public.plan_addons for select using (true);
create policy plan_addons_admin_write on public.plan_addons for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy platform_settings_admin_all on public.platform_settings for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy businesses_platform_admin_all on public.businesses for all
using (public.is_platform_admin()) with check (public.is_platform_admin());

comment on table public.platform_admins is 'Dueños de la plataforma Agen (no pertenecen a ningún negocio). Ven y administran todos los tenants.';
comment on column public.businesses.whatsapp_provider is 'EVOLUTION (QR autoservicio) · META (Cloud API oficial) · DIALOG360 (no verificado end-to-end, igual que en el origen MediCore).';
