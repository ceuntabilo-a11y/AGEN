create or replace function public.create_business_for_owner(
  p_name text,
  p_slug text,
  p_timezone text default 'America/Santiago',
  p_currency text default 'CLP',
  p_phone text default null,
  p_email text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid;
  v_name text := nullif(btrim(p_name), '');
  v_slug text := lower(nullif(btrim(p_slug), ''));
begin
  if v_user_id is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if v_name is null or length(v_name) > 120 then raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  if v_slug is null or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(v_slug) > 80 then
    raise exception 'INVALID_SLUG' using errcode = '22023';
  end if;
  if exists (select 1 from public.business_members where user_id = v_user_id and active) then
    raise exception 'USER_ALREADY_HAS_BUSINESS' using errcode = '23505';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023';
  end if;

  insert into public.businesses (name, slug, timezone, currency, phone, email, address)
  values (v_name, v_slug, p_timezone, upper(coalesce(nullif(btrim(p_currency), ''), 'CLP')), nullif(btrim(p_phone), ''), nullif(lower(btrim(p_email)), ''), nullif(btrim(p_address), ''))
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'OWNER');

  insert into public.branches (business_id, name, address, phone, timezone)
  values (v_business_id, 'Principal', nullif(btrim(p_address), ''), nullif(btrim(p_phone), ''), p_timezone);

  insert into public.specialties (business_id, name, slug, color) values
    (v_business_id, 'Peluquería', 'peluqueria', '#7c5cff'),
    (v_business_id, 'Manicure', 'manicure', '#17b890'),
    (v_business_id, 'Pedicure', 'pedicure', '#ff9f43'),
    (v_business_id, 'Masajes', 'masajes', '#2d9cdb'),
    (v_business_id, 'Estética', 'estetica', '#ff6f91'),
    (v_business_id, 'Barbería', 'barberia', '#475569'),
    (v_business_id, 'Otros', 'otros', '#64748b');

  return v_business_id;
end;
$$;

revoke all on function public.create_business_for_owner(text,text,text,text,text,text,text) from public;
grant execute on function public.create_business_for_owner(text,text,text,text,text,text,text) to authenticated;
