-- Foto del profesional (Tanda 7): recorte de fondo + color de marca o fondo con IA.
--
-- `professionals` no tenía dónde guardar una foto: solo el círculo de iniciales de siempre.
-- Idempotente. No borra ni cambia nada existente: solo agrega la columna.

alter table public.professionals add column if not exists photo_url text;
