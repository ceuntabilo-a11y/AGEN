create or replace function public.find_service_slots(
  p_business_id uuid,
  p_service_id uuid,
  p_from timestamptz,
  p_until timestamptz,
  p_interval_minutes integer default 15,
  p_limit integer default 20
)
returns table (
  professional_id uuid,
  professional_name text,
  specialty_id uuid,
  specialty_name text,
  service_id uuid,
  service_name text,
  service_start timestamptz,
  service_end timestamptz,
  quoted_price numeric
)
language sql stable security definer set search_path = public as $$
  select available.*
  from generate_series(p_from, p_until, make_interval(mins => greatest(p_interval_minutes, 5))) candidate
  cross join lateral public.find_available_professionals(p_business_id, p_service_id, candidate) available
  where p_until > p_from
  order by available.service_start, available.professional_name
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.find_service_slots(uuid, uuid, timestamptz, timestamptz, integer, integer) to authenticated, service_role;
comment on function public.find_service_slots is 'Busca alternativas reales dentro de una ventana sin mezclar servicios ni especialidades.';
