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
  v_hold public.appointment_holds;
  v_held_appointment public.appointments;
  v_hold_blocked integer;
  v_overlap_rejected boolean := false;
  v_wrong_professional_rejected boolean := false;
  v_resize_rejected boolean := false;
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

  v_hold := public.create_slot_hold(
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '2030-07-31 12:00:00-04'::timestamptz,
    '60000000-0000-0000-0000-000000000001',
    '+56900000001',15,'AI_AGENT'
  );
  if v_hold.id is null then raise exception 'No se creó el apartado temporal'; end if;

  select count(*) into v_hold_blocked
  from public.find_available_professionals(
    '10000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000001',
    '2030-07-31 12:00:00-04'::timestamptz
  ) where professional_id='40000000-0000-0000-0000-000000000001';
  if v_hold_blocked<>0 then raise exception 'El apartado temporal no bloqueó el horario'; end if;

  begin
    perform public.resize_safe_appointment(v_first.id,120);
  exception when sqlstate '23P01' then
    v_resize_rejected:=true;
  end;
  if not v_resize_rejected then raise exception 'La duración invadió un apartado activo'; end if;

  v_held_appointment:=public.confirm_held_appointment(
    v_hold.id,'60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null
  );
  if v_held_appointment.id is null then raise exception 'No se confirmó el apartado'; end if;

  begin
    perform public.move_safe_appointment(
      v_held_appointment.id,'2030-07-31 14:00:00-04'::timestamptz,'40000000-0000-0000-0000-000000000003'
    );
  exception when sqlstate '23P01' then
    v_wrong_professional_rejected:=true;
  end;
  if not v_wrong_professional_rejected then raise exception 'Se movió una reserva a una profesional incompatible'; end if;
end;
$$;

rollback;
