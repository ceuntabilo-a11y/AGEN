-- Invitaciones (Tanda 8): la persona invitada pide que la contacten, no crea su cuenta sola.
--
-- Hasta ahora "Invitar" llevaba directo a crear la cuenta y el negocio, sin que nadie del
-- equipo de Agen hablara con esa persona antes. El dueño aclaró que lo que quiere es al revés:
-- invitar a otro dueño de negocio para que PIDA que lo contacten, y recién ahí mostrarle el
-- producto en una entrevista de descubrimiento. Para eso hace falta guardar un teléfono (el
-- canal real de seguimiento) y, si lo escribe, a qué se dedica su negocio.
--
-- Idempotente. No borra ni cambia nada existente: solo agrega columnas.

alter table public.business_referrals add column if not exists referred_phone text;
alter table public.business_referrals add column if not exists referred_business_type text;

-- Un pedido de contacto puede llegar sin código de invitación (alguien encontró el enlace
-- suelto, o el código no correspondía a ningún negocio): antes era obligatorio atribuirlo a
-- un negocio, ahora puede quedar sin dueño y se ve igual en la bandeja de la plataforma.
alter table public.business_referrals alter column referrer_business_id drop not null;
