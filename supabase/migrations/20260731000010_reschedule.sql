create or replace function public.reschedule_safe_appointment(p_appointment_id uuid,p_new_start timestamptz)
returns public.appointments language plpgsql security definer set search_path=public as $$
declare
  v_old public.appointments;
  v_slot record;
  v_service public.services;
  v_duration integer;
  v_result public.appointments;
  v_min_hours integer;
begin
  select * into v_old from public.appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='Reserva inexistente'; end if;
  if auth.role()<>'service_role' and not public.is_business_member(v_old.business_id)
    and not exists(select 1 from public.clients where id=v_old.client_id and user_id=auth.uid()) then
    raise exception using errcode='42501',message='No autorizado';
  end if;
  select coalesce((settings->>'cancellation_hours')::integer,24) into v_min_hours from public.businesses where id=v_old.business_id;
  if auth.role()<>'service_role' and not public.is_business_member(v_old.business_id)
    and lower(v_old.service_period)-now()<make_interval(hours=>v_min_hours) then
    raise exception using errcode='P0001',message='La reserva está dentro del plazo restringido';
  end if;
  select * into v_service from public.services where id=v_old.service_id;
  select coalesce(custom_duration_minutes,v_service.duration_minutes) into v_duration from public.professional_services where professional_id=v_old.professional_id and service_id=v_old.service_id and active;
  perform pg_advisory_xact_lock(hashtextextended(v_old.professional_id::text,0));
  perform set_config('agen.suppress_notifications','on',true);
  update public.appointments set status='CANCELLED' where id=v_old.id;
  select * into v_slot from public.find_available_professionals(v_old.business_id,v_old.service_id,p_new_start) where professional_id=v_old.professional_id;
  if not found then raise exception using errcode='23P01',message='Nuevo horario no disponible'; end if;
  delete from public.appointment_resources where appointment_id=v_old.id;
  update public.appointments set
    period=tstzrange(p_new_start-make_interval(mins=>v_service.buffer_before_minutes),p_new_start+make_interval(mins=>v_duration+v_service.buffer_after_minutes),'[)'),
    service_period=tstzrange(p_new_start,p_new_start+make_interval(mins=>v_duration),'[)'),status=v_old.status,updated_at=now()
  where id=v_old.id returning * into v_result;
  insert into public.appointment_resources(appointment_id,resource_id,period)
  select v_result.id,sr.resource_id,v_result.period from public.service_resources sr join public.resources r on r.id=sr.resource_id and r.active where sr.service_id=v_result.service_id and sr.required;
  insert into public.notification_outbox(business_id,appointment_id,client_id,event_type,channel,payload)
  values(v_result.business_id,v_result.id,v_result.client_id,'RESCHEDULED','WHATSAPP',jsonb_build_object('appointmentId',v_result.id)) on conflict do nothing;
  insert into public.notification_outbox(business_id,appointment_id,client_id,event_type,channel,payload,scheduled_at)
  values
    (v_result.business_id,v_result.id,v_result.client_id,'REMINDER_24H','WHATSAPP',jsonb_build_object('appointmentId',v_result.id),lower(v_result.service_period)-interval '24 hours'),
    (v_result.business_id,v_result.id,v_result.client_id,'REMINDER_2H','WHATSAPP',jsonb_build_object('appointmentId',v_result.id),lower(v_result.service_period)-interval '2 hours')
  on conflict(appointment_id,event_type,channel) do update set scheduled_at=excluded.scheduled_at,processed_at=null,attempts=0,last_error=null;
  return v_result;
exception when exclusion_violation then
  raise exception using errcode='23P01',message='El horario acaba de ocuparse';
end;
$$;
grant execute on function public.reschedule_safe_appointment(uuid,timestamptz) to authenticated,service_role;

create or replace function public.cancel_safe_appointment(p_appointment_id uuid)
returns public.appointments language plpgsql security definer set search_path=public as $$
declare v_result public.appointments;v_min_hours integer;
begin
  select * into v_result from public.appointments where id=p_appointment_id for update;
  if not found then raise exception using errcode='P0002',message='Reserva inexistente'; end if;
  if auth.role()<>'service_role' and not public.is_business_member(v_result.business_id)
    and not exists(select 1 from public.clients where id=v_result.client_id and user_id=auth.uid()) then raise exception using errcode='42501',message='No autorizado'; end if;
  select coalesce((settings->>'cancellation_hours')::integer,24) into v_min_hours from public.businesses where id=v_result.business_id;
  if auth.role()<>'service_role' and not public.is_business_member(v_result.business_id)
    and lower(v_result.service_period)-now()<make_interval(hours=>v_min_hours) then raise exception using errcode='P0001',message='La reserva está dentro del plazo restringido'; end if;
  update public.appointments set status='CANCELLED',updated_at=now() where id=p_appointment_id returning * into v_result;
  return v_result;
end;
$$;
grant execute on function public.cancel_safe_appointment(uuid) to authenticated,service_role;
