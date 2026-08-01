begin;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.clients (id,business_id,full_name,phone) values
('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Cliente de prueba','+56900000001')
on conflict do nothing;

do $$
declare
  v_wrong_specialty_count integer;
  v_hair_count integer;
  v_first public.appointments;
  v_overlap_rejected boolean := false;
begin
  select count(*) into v_hair_count
  from public.find_available_professionals(
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '2030-07-31 10:00:00-04'::timestamptz
  );
  if v_hair_count <> 2 then raise exception 'Esperaba 2 peluqueras disponibles, obtuvo %', v_hair_count; end if;

  select count(*) into v_wrong_specialty_count
  from public.find_available_professionals(
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '2030-07-31 10:00:00-04'::timestamptz
  ) where professional_id = '40000000-0000-0000-0000-000000000003';
  if v_wrong_specialty_count <> 0 then raise exception 'Una manicurista apareció para peluquería'; end if;

  v_first := public.create_safe_appointment(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '2030-07-31 10:00:00-04'::timestamptz,
    'AI_AGENT',
    'Prueba de invariantes'
  );
  if v_first.id is null then raise exception 'La primera reserva no se creó'; end if;

  begin
    perform public.create_safe_appointment(
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      '2030-07-31 10:30:00-04'::timestamptz,
      'AI_AGENT',
      'Debe fallar'
    );
  exception when sqlstate '23P01' then
    v_overlap_rejected := true;
  end;
  if not v_overlap_rejected then raise exception 'El motor permitió una reserva solapada'; end if;
end;
$$;

rollback;
