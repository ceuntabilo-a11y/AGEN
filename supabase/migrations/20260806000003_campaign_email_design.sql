-- Correo de campaña: asunto propio y diseño HTML generado con IA.
alter table public.campaigns add column if not exists subject text;
alter table public.campaigns add column if not exists email_html text;
