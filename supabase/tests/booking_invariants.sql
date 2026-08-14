-- Invariantes de reservas. Autocontenido: crea sus propios datos, comprueba y hace ROLLBACK.
--
-- No depende de `seed.sql` ni de ningún dato existente: usa un negocio de prueba con ids y
-- slug propios (prefijo f…) que no colisionan con nada real. Todo ocurre dentro de una única
-- transacción que termina en `rollback`, así que al terminar la base queda exactamente igual
-- que antes — no se crea ningún negocio, ni cliente, ni reserva permanente.
--
-- Se ejecuta tal cual en el SQL Editor de Supabase.

begin;
select set_config('request.jwt.claim.role', 'service_role', true);

-- ---------------------------------------------------------------------------
-- Datos de prueba. Mismo modelo que `seed.sql`, con identificadores propios.
-- El 31 de julio de 2030 es miércoles (weekday 3), dentro del horario 1..6 de abajo.
-- ---------------------------------------------------------------------------

insert into public.businesses (id,name,slug,timezone,currency,address) values
('f1000000-0000-0000-0000-000000000001','Invariantes de reservas','test-invariantes-reservas','America/Santiago','CLP','Calle de prueba 1');

insert into public.branches (id,business_id,name,address) values
('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Sucursal de prueba','Calle de prueba 1');

insert into public.specialties (id,business_id,name,slug,color) values
('f3000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Peluquería','peluqueria','#7c5cff'),
('f3000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','Manicure','manicure','#17b890');

-- Dos peluqueras y una manicurista: la manicurista no debe aparecer nunca para peluquería.
insert into public.professionals (id,business_id,branch_id,display_name,color,commission_percent) values
('f4000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','Peluquera Uno','#7c5cff',35),
('f4000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','Peluquera Dos','#ff6f91',35),
('f4000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','Manicurista','#17b890',35);

-- `buffer_after_minutes` = 10: es lo que hace que alargar la reserva de las 10:00 a 120
-- minutos invada el apartado de las 12:00.
insert into public.services (id,business_id,specialty_id,name,duration_minutes,buffer_after_minutes,price,material_cost,deposit_amount) values
('f5000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','Corte y peinado',60,10,28000,3500,5600),
('f5000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000002','Manicure permanente',75,10,24000,4200,4800);

insert into public.professional_services (professional_id,service_id) values
('f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001'),
('f4000000-0000-0000-0000-000000000002','f5000000-0000-0000-0000-000000000001'),
('f4000000-0000-0000-0000-000000000003','f5000000-0000-0000-0000-000000000003');

insert into public.professional_availability (professional_id,branch_id,weekday,starts_at,ends_at)
select p.id,'f2000000-0000-0000-0000-000000000001',d,'09:00','19:00'
from public.professionals p cross join generate_series(1,6) d
where p.business_id='f1000000-0000-0000-0000-000000000001';

insert into public.clients (id,business_id,full_name,phone) values
('f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Cliente de prueba','+56900000001'),
('f6000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','Cliente en lista de espera','+56900000002');

-- Alguien esperando ese servicio: al cancelar, el cupo liberado tiene que ofrecérsele UNA vez.
insert into public.waitlist_entries (id,business_id,client_id,service_id,professional_id,preferred_from,preferred_until,status) values
('f7000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f6000000-0000-0000-0000-000000000002',
 'f5000000-0000-0000-0000-000000000001',null,
 '2030-07-31 00:00:00-04'::timestamptz,'2030-08-01 00:00:00-04'::timestamptz,'WAITING');

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
  v_cancelada_otra_vez public.appointments;
  v_avisos_cancelacion integer;
  v_contactados_antes integer;
  v_contactados_despues integer;
begin
  -- 1. Disponibilidad: las dos peluqueras, y solo ellas.
  select count(*) into v_hair_count
  from public.find_available_professionals(
    'f1000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    '2030-07-31 10:00:00-04'::timestamptz
  );
  if v_hair_count <> 2 then raise exception 'Esperaba 2 peluqueras disponibles, obtuvo %', v_hair_count; end if;

  select count(*) into v_wrong_specialty_count
  from public.find_available_professionals(
    'f1000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    '2030-07-31 10:00:00-04'::timestamptz
  ) where professional_id = 'f4000000-0000-0000-0000-000000000003';
  if v_wrong_specialty_count <> 0 then raise exception 'Una manicurista apareció para peluquería'; end if;

  -- 2. Se crea una reserva.
  v_first := public.create_safe_appointment(
    'f1000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000001',
    'f6000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    '2030-07-31 10:00:00-04'::timestamptz,
    'AI_AGENT',
    'Prueba de invariantes'
  );
  if v_first.id is null then raise exception 'La primera reserva no se creó'; end if;

  -- 3. Anti-solape: la misma profesional a las 10:30 invade la reserva de las 10:00.
  begin
    perform public.create_safe_appointment(
      'f1000000-0000-0000-0000-000000000001',
      'f2000000-0000-0000-0000-000000000001',
      'f6000000-0000-0000-0000-000000000001',
      'f4000000-0000-0000-0000-000000000001',
      'f5000000-0000-0000-0000-000000000001',
      '2030-07-31 10:30:00-04'::timestamptz,
      'AI_AGENT',
      'Debe fallar'
    );
  exception when sqlstate '23P01' then
    v_overlap_rejected := true;
  end;
  if not v_overlap_rejected then raise exception 'El motor permitió una reserva solapada'; end if;

  -- 4. Un apartado temporal bloquea el horario igual que una reserva.
  v_hold := public.create_slot_hold(
    'f1000000-0000-0000-0000-000000000001',
    'f4000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    '2030-07-31 12:00:00-04'::timestamptz,
    'f6000000-0000-0000-0000-000000000001',
    '+56900000001',15,'AI_AGENT'
  );
  if v_hold.id is null then raise exception 'No se creó el apartado temporal'; end if;

  select count(*) into v_hold_blocked
  from public.find_available_professionals(
    'f1000000-0000-0000-0000-000000000001',
    'f5000000-0000-0000-0000-000000000001',
    '2030-07-31 12:00:00-04'::timestamptz
  ) where professional_id='f4000000-0000-0000-0000-000000000001';
  if v_hold_blocked<>0 then raise exception 'El apartado temporal no bloqueó el horario'; end if;

  -- 5. Alargar la reserva no puede invadir un apartado activo.
  begin
    perform public.resize_safe_appointment(v_first.id,120);
  exception when sqlstate '23P01' then
    v_resize_rejected:=true;
  end;
  if not v_resize_rejected then raise exception 'La duración invadió un apartado activo'; end if;

  -- 6. El apartado se convierte en reserva.
  v_held_appointment:=public.confirm_held_appointment(
    v_hold.id,'f6000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',null
  );
  if v_held_appointment.id is null then raise exception 'No se confirmó el apartado'; end if;

  -- 7. No se puede mover a una profesional que no hace ese servicio.
  begin
    perform public.move_safe_appointment(
      v_held_appointment.id,'2030-07-31 14:00:00-04'::timestamptz,'f4000000-0000-0000-0000-000000000003'
    );
  exception when sqlstate '23P01' then
    v_wrong_professional_rejected:=true;
  end;
  if not v_wrong_professional_rejected then raise exception 'Se movió una reserva a una profesional incompatible'; end if;

  -- 8. Cancelar dos veces no puede avisar dos veces ni volver a ofrecer el cupo.
  --    Antes de 20260813000001, la segunda llamada reescribía CANCELLED, encolaba otro aviso
  --    CHANGED y le ofrecía el mismo hueco a otras personas de la lista de espera.
  perform public.cancel_safe_appointment(v_held_appointment.id, 'El cliente no puede', 'Prueba');

  select count(*) into v_avisos_cancelacion
    from public.notification_outbox
    where appointment_id = v_held_appointment.id and event_type = 'CHANGED';
  if v_avisos_cancelacion <> 1 then
    raise exception 'La primera cancelación dejó % avisos CHANGED, esperaba 1', v_avisos_cancelacion;
  end if;

  select count(*) into v_contactados_antes
    from public.waitlist_entries
    where business_id = 'f1000000-0000-0000-0000-000000000001' and status = 'CONTACTED';
  if v_contactados_antes <> 1 then
    raise exception 'La primera cancelación contactó a % de la lista de espera, esperaba 1', v_contactados_antes;
  end if;

  v_cancelada_otra_vez := public.cancel_safe_appointment(v_held_appointment.id, 'Reintento', 'Prueba');
  if v_cancelada_otra_vez.status <> 'CANCELLED' then
    raise exception 'La segunda cancelación devolvió el estado %', v_cancelada_otra_vez.status;
  end if;

  select count(*) into v_avisos_cancelacion
    from public.notification_outbox
    where appointment_id = v_held_appointment.id and event_type = 'CHANGED';
  if v_avisos_cancelacion <> 1 then
    raise exception 'Cancelar dos veces dejó % avisos CHANGED, esperaba 1', v_avisos_cancelacion;
  end if;

  select count(*) into v_contactados_despues
    from public.waitlist_entries
    where business_id = 'f1000000-0000-0000-0000-000000000001' and status = 'CONTACTED';
  if v_contactados_despues <> v_contactados_antes then
    raise exception 'La segunda cancelación contactó a % personas más de la lista de espera',
      v_contactados_despues - v_contactados_antes;
  end if;

  raise notice 'Invariantes de reservas: todas las comprobaciones pasaron.';
end;
$$;

rollback;
