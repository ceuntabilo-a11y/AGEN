-- Ciclo de vida comercial de un negocio: demo, vigencia, invitación del dueño y logo.
--
-- Por qué hace falta: la plataforma sabía si un negocio estaba activo o suspendido, y nada más.
-- No había forma de responder "esta semana entregué 50 demos, cuántas siguen vivas y cuántas se
-- convirtieron", porque no existía el concepto de demo ni el de vencimiento. Tampoco se podía
-- saber si el dueño llegó a entrar: la invitación se generaba y se olvidaba.
--
-- Aditiva y idempotente. No borra ni reescribe nada: los negocios que ya existen quedan como
-- clientes sin vencimiento (`is_demo=false`, `expires_on=null`), que es exactamente su estado
-- de hoy.

-- ── Vigencia y tipo de negocio ────────────────────────────────────────────────────────────────
alter table businesses add column if not exists is_demo boolean not null default false;
alter table businesses add column if not exists starts_on date;
alter table businesses add column if not exists expires_on date;
alter table businesses add column if not exists converted_at timestamptz;
alter table businesses add column if not exists logo_url text;

comment on column businesses.is_demo is 'Demo o prueba comercial. Un negocio pagado tiene false.';
comment on column businesses.starts_on is 'Primer día de vigencia. Null = desde siempre.';
comment on column businesses.expires_on is 'Último día de vigencia, inclusive. Null = sin vencimiento.';
comment on column businesses.converted_at is 'Cuándo esta demo pasó a cliente pagado. Null = no convertida.';

-- Los negocios que ya existían empiezan el día que se crearon: sin esto, "nuevos esta semana"
-- no puede distinguirlos y la vigencia arranca vacía.
update businesses set starts_on = created_at::date where starts_on is null;

create index if not exists businesses_expires_on_idx on businesses (expires_on) where expires_on is not null;
create index if not exists businesses_is_demo_idx on businesses (is_demo) where is_demo;

-- ── Invitación del dueño ──────────────────────────────────────────────────────────────────────
-- Una fila por negocio y correo invitado. Guarda el estado que el panel necesita mostrar
-- (enviada, pendiente, activada, vencida) y cuántas veces se reenvió, sin guardar jamás el
-- enlace ni ninguna credencial: el enlace lo emite Supabase en cada envío y caduca solo.
create table if not exists business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  user_id uuid,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'EXPIRED')),
  sent_at timestamptz not null default now(),
  sent_count integer not null default 1,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists business_invitations_negocio_correo_idx
  on business_invitations (business_id, lower(email));
create index if not exists business_invitations_status_idx on business_invitations (status);

comment on table business_invitations is
  'Estado de la invitación del dueño de cada negocio. Nunca guarda el enlace ni una contraseña.';

alter table business_invitations enable row level security;

-- Solo el service role (las rutas de /api/platform) la toca. Ningún usuario final la lee: por
-- eso no hay política permisiva — con RLS activo y sin política, nadie más pasa.
drop policy if exists business_invitations_member_read on business_invitations;
create policy business_invitations_member_read on business_invitations
  for select using (
    exists (
      select 1 from business_members m
      where m.business_id = business_invitations.business_id
        and m.user_id = auth.uid()
        and m.role in ('OWNER', 'ADMIN')
    )
  );

-- ── Vencer solas ──────────────────────────────────────────────────────────────────────────────
-- Una invitación no caduca "cuando alguien la mira": esta función la marca vencida de verdad,
-- y la llama el panel al listar. Es idempotente y no toca las ya aceptadas.
create or replace function expire_stale_invitations()
returns integer
language sql
security definer
set search_path = public
as $$
  with vencidas as (
    update business_invitations
       set status = 'EXPIRED', updated_at = now()
     where status = 'PENDING' and expires_at < now()
     returning 1
  )
  select coalesce(count(*), 0)::integer from vencidas;
$$;

revoke all on function expire_stale_invitations() from public;
