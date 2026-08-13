-- Cancelar dos veces la misma reserva no puede avisar dos veces ni vaciar la lista de espera.
--
-- Qué estaba pasando: `cancel_safe_appointment` bloqueaba la fila (`for update`, así que dos
-- llamadas concurrentes se serializan bien) pero NO miraba el estado antes de actuar. Con la
-- reserva ya en CANCELLED, la segunda llamada volvía a poner CANCELLED y además:
--
--   * encolaba un SEGUNDO aviso `CHANGED/CANCEL`, así que el cliente recibía dos veces
--     "cancelamos tu hora" por un solo clic repetido o por un reintento tras un timeout;
--   * volvía a llamar a `offer_freed_slot_to_waitlist`, que toma hasta 5 entradas `WAITING`
--     y las pasa a `CONTACTED` — la segunda pasada agarraba a OTRAS cinco personas, así que
--     un único cupo liberado se le ofrecía hasta a diez.
--
-- Es el mismo principio que ya aplicaba a resize/reschedule/move desde
-- `20260808000001_agenda_change_guards.sql`: un cambio que no cambia nada no es un cambio.
-- Ahora cancelar es idempotente: si ya estaba cancelada se devuelve la reserva tal cual, sin
-- escribir, sin avisar y sin tocar la lista de espera.
--
-- Reversible: sí, volviendo a aplicar la definición de `20260807000002`.
-- Modifica datos: no. Solo reemplaza la función.
-- Destructiva: no.

create or replace function public.cancel_safe_appointment(
  p_appointment_id uuid,
  p_reason text,
  p_actor text
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare v_result public.appointments; v_min_hours integer;
begin
  select * into v_result from public.appointments where id = p_appointment_id for update;
  if not found then raise exception using errcode='P0002', message='Reserva inexistente'; end if;

  -- Idempotencia: ya estaba cancelada. Se devuelve tal cual, antes de cualquier efecto.
  -- Va después del cerrojo a propósito: así dos cancelaciones simultáneas se ordenan y la
  -- segunda ve el estado que dejó la primera, no el que leyó antes de esperar.
  if v_result.status = 'CANCELLED' then return v_result; end if;

  if auth.role() <> 'service_role' and not public.is_business_member(v_result.business_id)
    and not exists(select 1 from public.clients where id = v_result.client_id and user_id = auth.uid())
  then raise exception using errcode='42501', message='No autorizado'; end if;
  select coalesce((settings->>'cancellation_hours')::integer, 24) into v_min_hours
    from public.businesses where id = v_result.business_id;
  if auth.role() <> 'service_role' and not public.is_business_member(v_result.business_id)
    and lower(v_result.service_period) - now() < make_interval(hours => v_min_hours)
  then raise exception using errcode='P0001', message='La reserva está dentro del plazo restringido'; end if;

  perform set_config('agen.suppress_notifications', 'on', true);
  update public.appointments set status = 'CANCELLED', updated_at = now()
    where id = p_appointment_id returning * into v_result;

  delete from public.notification_outbox
    where appointment_id = v_result.id and processed_at is null
      and event_type in ('REMINDER_24H','REMINDER_2H','CONFIRM_REQUEST','DAY_OF_REMINDER');
  perform public.enqueue_appointment_event(v_result.id, 'CHANGED', now(), jsonb_build_object(
    'kind', 'CANCEL',
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'actor', nullif(btrim(coalesce(p_actor, '')), '')
  ));
  perform public.offer_freed_slot_to_waitlist(v_result.id);
  return v_result;
end;
$$;

revoke all on function public.cancel_safe_appointment(uuid,text,text) from public, anon;
grant execute on function public.cancel_safe_appointment(uuid,text,text) to authenticated, service_role;
