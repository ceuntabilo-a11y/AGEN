# CLAUDE.md — Agen

Este repo ya tiene una guía completa de arquitectura, convenciones y reglas de negocio en
[`QWEN.md`](QWEN.md). Léela y síguela como si fuera este archivo — no se duplica aquí.
Incluye la sección 6.1 (capa de plataforma/super admin, canales WhatsApp, voz, copiloto real,
marketing con IA) añadida el 2026-08-05.

## Modo de trabajo (obligatorio)

- Trabajar en silencio: nada de narrar pasos internos, sin chat de relleno mientras se
  ejecutan herramientas. El texto visible debe limitarse a: una frase antes de empezar,
  avisos puntuales si algo cambia de rumbo o se traba, y un resumen final corto (qué se
  hizo, qué falta). Nada de explicaciones largas ni "voy a hacer X, ahora Y, ahora Z".
- Todo resultado se entrega terminado y verificado, nunca a medias.

## Push a este repositorio

- `git push` normal (rama `main`, sin `--force`) está pre-autorizado: no hace falta pedir
  confirmación en el chat cada vez.
- Regla que nunca se rompe, sin excepción:
  1. Nunca romper algo que ya funciona.
  2. Nunca subir un cambio de lógica que el usuario no haya autorizado explícitamente en el
     chat — un push solo puede contener lo que se pidió y se conversó, nada añadido por
     iniciativa propia.
  3. Antes de cualquier push: correr `npm run lint` y `npm run typecheck` en verde (y
     `supabase/tests/booking_invariants.sql` si se tocó SQL de reservas). Si algo no se pudo
     probar, decirlo explícitamente en el resumen final — nunca presentarlo como probado.
- `git push --force` (o cualquier variante que reescriba historia) sigue pidiendo
  confirmación explícita en el chat; no está pre-autorizado bajo ninguna circunstancia.

## Permisos generales

- Fuera del push descrito arriba, todo comando (Bash, edición de archivos, migraciones,
  etc.) sigue pidiendo permiso normal antes de ejecutarse. No hay modo "bypass" general.
