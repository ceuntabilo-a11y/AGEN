-- Marketing: enviar por WhatsApp y correo a la vez, y filtros de CRM en la audiencia.
--
-- Hasta ahora una campaña solo podía ir por un canal (`channel`), y `campaign_recipients` tenía
-- una sola fila por (campaña, cliente): no había forma de registrar que a la misma persona se
-- le mandó por WhatsApp Y por correo dentro de la misma campaña.
--
-- Idempotente. No borra datos de campañas ni de destinatarios: solo agrega la columna
-- `channel` a `campaign_recipients` (rellenada desde la campaña para las filas que ya existen),
-- amplía el canal permitido en `campaigns` con 'BOTH', y cambia la unicidad de
-- (campaña, cliente) a (campaña, cliente, canal) para que quepan las dos filas.

alter table public.campaigns drop constraint if exists campaigns_channel_check;
alter table public.campaigns add constraint campaigns_channel_check
  check (channel in ('WHATSAPP', 'INSTAGRAM', 'MESSENGER', 'EMAIL', 'PUSH', 'BOTH'));

alter table public.campaign_recipients add column if not exists channel text;

update public.campaign_recipients cr
set channel = c.channel
from public.campaigns c
where cr.campaign_id = c.id and cr.channel is null;

alter table public.campaign_recipients drop constraint if exists campaign_recipients_campaign_id_client_id_key;
alter table public.campaign_recipients add constraint campaign_recipients_campaign_client_channel_key
  unique (campaign_id, client_id, channel);
