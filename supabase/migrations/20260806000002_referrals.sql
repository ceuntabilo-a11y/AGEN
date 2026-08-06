-- Programa de invitaciones: cada negocio tiene su código y se registra a quién invitó.
-- Idempotente y sin tocar nada existente.

alter table public.businesses add column if not exists referral_code text;

create unique index if not exists businesses_referral_code_key on public.businesses (referral_code) where referral_code is not null;

-- Código estable derivado del id, para los negocios que ya existían.
update public.businesses set referral_code = upper(substr(replace(id::text, '-', ''), 1, 8)) where referral_code is null;

create table if not exists public.business_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_business_id uuid not null references public.businesses(id) on delete cascade,
  referred_business_id uuid references public.businesses(id) on delete set null,
  referred_name text,
  referred_email text,
  status text not null default 'PENDING' check (status in ('PENDING', 'REGISTERED', 'REWARDED', 'CANCELLED')),
  reward_percent numeric(5,2),
  reward_note text,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (referred_business_id)
);

create index if not exists business_referrals_referrer_idx on public.business_referrals (referrer_business_id, created_at desc);

alter table public.business_referrals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'business_referrals' and policyname = 'business_referrals_member_read') then
    create policy business_referrals_member_read on public.business_referrals
      for select using (public.is_business_member(referrer_business_id));
  end if;
end $$;
