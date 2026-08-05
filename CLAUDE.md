# CLAUDE.md — Agen

Guía completa de arquitectura, convenciones, reglas de negocio y modo de trabajo de este
repositorio. Única referencia — no depende de ningún otro archivo de guía. Incluye la
sección 6.1 (capa de plataforma/super admin, canales WhatsApp, voz, copiloto real, marketing
con IA) añadida el 2026-08-05.

Agenda + Agente inteligente para negocios de servicios (peluquerías, estética, barberías).
Multi-tenant: cada negocio gestiona profesionales, servicios, agenda, clientes, cotizaciones,
campañas y seguimiento. Un agente IA (n8n + OpenAI) atiende clientes por WhatsApp u otros
canales y reserva vía la API de la app — nunca toca la base de datos directamente.

**Stack:** Next.js 15.5 App Router · React 18 · TypeScript estricto · Tailwind ·
Supabase (PostgreSQL + Auth + Storage) · n8n · PWA. Node 22 (engines >=20.9 <25).

## 1. Arquitectura por capas

1. **Frontend** (`src/app`, `src/components`): casi todas las páginas son `'use client'` y
   consumen las API routes propias. Excepciones server: `/` (landing), `/login` (shell),
   `/admin/agente` (estática). Chrome común en `DashboardShell`.
2. **API routes** (`src/app/api/**`): única puerta con lógica de negocio. Auth por sesión
   Supabase o secreto compartido (`x-agen-secret`).
3. **PostgreSQL**: autoridad final. Toda integridad de agenda (solapamientos, buffers, holds,
   revalidación) vive en funciones SQL, no en TypeScript.
4. **n8n** (`n8n-workflows/`): 01 agente conversacional, 02 recordatorios (outbox),
   03 campañas, 04 seguimientos/resumen diario. Habla con la app solo por HTTPS con header
   `x-agen-secret`; el LLM usa tools HTTP `/api/agent/*`, nunca SQL ni nodos Postgres.
5. **Gateways de mensajería**: n8n envía JSON normalizado a un gateway intercambiable
   (WhatsApp Cloud API, email, Instagram, Messenger, push). Contrato `{success, error}`.

### Modelo de datos (migraciones en `supabase/migrations`)

- **Organización:** `businesses` (`timezone`, `settings`, `agent_settings`, `maps_url`),
  `branches`, `business_members` (roles: OWNER, ADMIN, PROFESSIONAL, RECEPTIONIST).
- **Catálogo:** `specialties`, `professionals`, `professional_specialties`, `services`,
  `professional_services` (**lista autorizada** servicio↔profesional; nunca inferirla),
  `professional_availability`, `schedule_blocks`.
- **Reservas:** `appointments` (`period` con buffers para conflictos vs `service_period`
  visible), `appointment_holds` (apartados temporales), recursos (`resources`,
  `service_resources`, `appointment_resources`), `audit_log`.
- **CRM:** `clients`, `client_memory`, `communication_consents`, `conversations`, `messages`,
  `waitlist_entries`, `follow_up_tasks`.
- **Comercial:** `quotes`/`quote_items`, `payments`, `expenses`, `portfolio_items`,
  `campaigns`/`campaign_recipients`.
- **Operación:** `notification_outbox`, `team_notifications`, `login_attempts`.

### Regla de oro: reservas

**Nadie inserta directamente en `appointments`** — ni app, ni agente, ni portal cliente.
Todo pasa por funciones SQL transaccionales (SECURITY DEFINER), vía `db.rpc()`:
`create_safe_appointment` (crear; sources ADMIN/CLIENT/AI_AGENT),
`confirm_held_appointment` (convierte hold en reserva, delega en create),
`create_slot_hold` (aparta 5–30 min, solo service_role), `reschedule_safe_appointment`,
`cancel_safe_appointment` (plazo `cancellation_hours` solo para clientes),
`move_safe_appointment`, `resize_safe_appointment`,
`find_available_professionals` (solo service_role) / `find_service_slots`.
Garantías internas: autorización, cerrojo advisory por profesional, revalidación de
disponibilidad, precios/duración desde `professional_services`, inserción atómica con
recursos. Anti-solape por restricción EXCLUDE gist.
**Errcodes:** `23P01` conflicto de horario → 409 `conflict:true`; `23505` duplicado → 409;
`42501` sin autorización; `P0002` entidad inválida; `P0001` regla de negocio;
`22007` fecha pasada; `22023` parámetro inválido.

**Flujo del agente:** identificar servicio → `find_service_slots` (aparta hasta 3 slots con
`holdId`, 15 min) → confirmar con `confirm_held_appointment` + `holdId`. HTTP 409 = cupo
ocupado/hold vencido → reconsultar y ofrecer alternativas. Nunca afirmar reserva sin
`booked=true` (guarda anti confirmaciones fantasma). No mezclar especialidades.

### Zona horaria

`businesses.timezone` (IANA) es la fuente de verdad. Nunca usar la zona del servidor para
"hoy"/rangos/horarios visibles: en SQL el motor evalúa disponibilidad en hora local; en TS
usar SIEMPRE `@/lib/timezone` (`dateKeyInZone`, `zonedDayRange`, `zonedDateTimeToUtc`,
`formatTimeInZone`). Almacenar siempre `timestamptz`/`tstzrange`.

## 2. Organización

```
src/app/            Páginas: admin/ (11), profesional/ (6), cliente/ (5), auth, login,
                    registro, crear-negocio, configurar-negocio, recuperar-clave, unsubscribe
  api/              52 rutas: admin/, agent/, automation/, client/, professional/, auth/,
                    calendar/[token] (ICS), health, status, session, setup, notifications,
                    unsubscribe
src/components/     Compartidos: DashboardShell, modales, Copilot, NotificationBell…
src/lib/            Helpers de servidor (abajo)
supabase/           migrations/ (14, aplicar EN ORDEN), seed.sql (demo "Bella Studio"),
                    tests/booking_invariants.sql
n8n-workflows/      4 workflows + README con las 11 reglas del agente
docs/               EASYPANEL.md, AGEN_IMPROVEMENTS.md
cloudflare/         Worker agen-web-router: proxy inverso de agen.synetia.site
public/             sw.js, manifest.webmanifest, offline.html (PWA sin caché privado)
middleware.ts       Protege /admin, /profesional, /cliente por sesión y rol
```

**Helpers `src/lib` (usarlos, no reimplementarlos):** `supabase.ts` (browser),
`supabase-server.ts` (`createServerSupabase` + `requireBusinessContext(roles?)`),
`supabase-admin.ts` (`createAdminClient`, service role solo servidor),
`client-context.ts` (`requireClientContext`), `professional-context.ts`,
`agent-auth.ts` (`isAuthorizedAgent`, `timingSafeEqual`), `agent-actor.ts` (reconoce al
equipo por teléfono; modo TEAM solo lectura), `http-errors.ts` (`apiError`:
UNAUTHORIZED→401, FORBIDDEN→403, resto→500), `timezone.ts`, `phone.ts` (`normalizePhone`),
`money.ts` (es-CL).

## 3. Convenciones y estilo

- Código e identificadores en inglés; UI, errores y comentarios de negocio en español.
- Alias `@/*` → `src/*`. Tailwind sin tema extendido. ESLint next/core-web-vitals con
  `--max-warnings=0`.
- **API routes:** body con `await request.json() as {…}` + validación manual campo a campo
  → 400 (no hay zod; no agregarlo sin necesidad). Errores: `try/catch` → `apiError`; los de
  negocio responden `NextResponse.json({error:'…español'},{status})`. Roles:
  `requireBusinessContext(['OWNER','ADMIN',…])`; CLIENT no es rol de `business_members`
  (va por `requireClientContext`); PROFESSIONAL además se filtra por `professional_id`
  derivado de `member_id`. Multi-tenancy: toda query `.eq('business_id', businessId)`;
  RPC con `p_business_id`. PATCH: whitelist explícita, nunca body directo. Paralelismo:
  `Promise.all` + `const error = a.error || b.error`. GETs con
  `export const dynamic = 'force-dynamic'`. Respuestas en objeto (`{appointments}`,
  `{ok:true}`); 201 en creaciones.
- **SQL:** tablas snake_case plural; políticas `{tabla}_member_all|_member_read|_client_read|
  _public_read`; mutaciones `*_safe_appointment`; consultas `find_*`; colas
  `queue_*`/`enqueue_*`/`claim_*`; enums SCREAMING_SNAKE_CASE; triggers `{tabla}_{acción}`;
  migraciones idempotentes. GUC `agen.suppress_notifications` silencia notificaciones internas.
- Límites: `.limit()` en listados, recortes de longitud (notas 1000, títulos 120–160,
  resúmenes 4000), `normalizePhone()` en todos los teléfonos.

## 4. Seguridad (no negociable)

- `SUPABASE_SERVICE_ROLE_KEY` solo en servidor; jamás en `NEXT_PUBLIC_*` ni navegador.
- API de agente/automatización exigen `x-agen-secret` comparado con `timingSafeEqual`.
- Secretos n8n solo en variables de entorno (`AGEN_*`), nunca en el JSON del workflow.
- `middleware.ts` protege páginas, pero cada API revalida autorización (defensa en profundidad).
- Modo equipo solo lectura: doble guardia — prompt del agente + APIs (`/api/agent/book`,
  `/slots`, `/clients`) rechazan al equipo con 403.
- Rate limiting de login (`login_attempts`, hashes SHA-256, revocado del navegador).
- Cabeceras estrictas en `next.config.mjs` (CSP, HSTS); no relajarlas.
- Service worker nunca cachea `/api/`, `/admin`, `/profesional`, `/cliente`.
- Galería: publicar exige `client_consent`. Marketing solo con consentimientos vigentes;
  email de campaña incluye `unsubscribeUrl`.

## 5. Reglas para modificaciones

1. Nunca insertar/actualizar `appointments` desde TS: usar RPC seguros; si se necesita una
   mutación nueva, crear función SQL `*_safe_appointment` (cerrojo advisory + revalidación +
   errcodes convencionales).
2. Migraciones append-only: no editar las aplicadas; agregar `YYYYMMDDNNNNNN_desc.sql`
   idempotente. Aplicar en orden (13 y 14 = mejoras del roadmap Agen).
3. Disponibilidad jamás calculada a mano en TS: siempre `find_available_professionals` /
   `find_service_slots`. Nunca ofrecer profesional de otra especialidad.
4. Fechas siempre con `business.timezone` + `@/lib/timezone`.
5. APIs nuevas: patrón existente de roles, `apiError`, whitelist PATCH, multi-tenancy.
6. n8n: solo tools HTTP `/api/agent/*`; parámetros del modelo con `$fromAI`, datos del
   webhook (businessId, phone) inyectados directo para que el modelo no los altere.
7. Compatibilidad de esquema: mantener fallbacks sin columnas nuevas (`maps_url`,
   `claimed_at`, `marketing_unsubscribe_token`) si la app se despliega antes que la migración.
8. Ante 409 de reserva, el frontend reconsulta slots y ofrece alternativas.

## 6. Qué NUNCA debe hacerse

- Escribir en `appointments` sin función `*_safe_appointment`.
- Exponer la service role key al cliente o subirla al repo (`.env*` en `.gitignore`).
- Guardar secretos en los JSON de workflows.
- Editar migraciones ya aplicadas en producción.
- Autorizar solo en el navegador; el LLM escribiendo SQL o inventando servicios/precios.
- Cachear rutas privadas/APIs en el service worker.
- Afirmar reservas sin `booked=true`.
- Activar workflows n8n sin credenciales y gateways probados (se exportan inactivos).
- Romper el contrato de gateways: `{success, error}` + `unsubscribeUrl` en email.

## 6.1 Capa SaaS de plataforma (super admin), canales, voz y copiloto real

Añadido en `20260805000001_platform_saas_layer.sql` (aplicar después de la 14).

- **Plataforma (`/plataforma`, rol `platform_admins`):** no es un rol de `business_members`
  (es dueño de la plataforma, no de un negocio). `requirePlatformAdmin()` en
  `src/lib/platform-context.ts`. Panel: negocios (crear con invitación por correo, suspender,
  eliminar en cascada con confirmación escrita), planes (`membership_plans`) y complementos
  (`plan_addons`: `IMAGE_ANALYSIS`, `VOICE_NOTES`, `VOICE_CALLS`) con precio editable, monitor
  de salud (Supabase/n8n), claves de plataforma de respaldo (`platform_settings`: OpenAI,
  DashScope). APIs en `src/app/api/platform/**`.
- **Canales de WhatsApp por negocio** (`businesses.whatsapp_provider`: `EVOLUTION` | `META` |
  `DIALOG360`, más `whatsapp_instance`/`whatsapp_phone_id`/`whatsapp_token`/
  `whatsapp_360_api_key`). UI en `/admin/integraciones`. Evolution se conecta por QR
  autoservicio (`src/lib/whatsapp.ts`, `/api/admin/integrations/whatsapp/*`, requiere
  `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`). El envío de marketing por WhatsApp rutea por
  proveedor (`sendWhatsApp()`); si el negocio no tiene proveedor configurado, cae al flujo
  histórico por gateway n8n. **DIALOG360 no está verificado con envío real** (tampoco lo
  estaba en el origen MediCore) — probarlo con una cuenta real antes de depender de él.
- **Capacidades multimedia del agente:** `businesses.feature_image` / `feature_voice`
  (apagadas por defecto). El workflow `01-agen-agent.json` llama a `/api/agent/media` (nuevo)
  para transcribir audio (Whisper) o describir imágenes (Vision) solo si el negocio activó la
  capacidad; si no, el agente sigue como si fuera solo texto.
- **Voz de salida:** `agent_settings.voice`/`agent_settings.behavior` (5ª pestaña de
  `/admin/agente`). `src/lib/voice.ts` implementa Qwen3-TTS/DashScope (clave
  `businesses.dashscope_api_key`, con respaldo de plataforma). `POST /api/agent/voice/reply`
  (llamado por el nodo "Responder con voz" de n8n) nunca deja al agente mudo: cualquier
  fallo devuelve `speak:false,sendText:true`. Nunca responde con voz en modo equipo
  (`actorType==='TEAM'`). Botón "Probar voz" → `/api/admin/agent/voice-preview`.
- **Copiloto real:** `/api/admin/copilot` ahora llama a OpenAI (`gpt-4o-mini`) con los mismos
  datos ya calculados por el servidor — el modelo nunca toca la base de datos ni inventa
  cifras. Límite 30/min por negocio (`src/lib/rate-limit.ts`). Si OpenAI falla, cae al texto
  determinista anterior (nunca deja al usuario sin respuesta).
- **Marketing con IA:** `POST /api/admin/campaigns/generate` redacta el texto de la campaña
  con la clave OpenAI del negocio; `campaigns.image_url` permite adjuntar una imagen (URL) que
  se envía junto al texto cuando el proveedor de WhatsApp lo soporta.

## 7. Entorno y despliegue

Variables nuevas: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (Evolution API compartida por la
plataforma para instancias por negocio), `OPENAI_API_KEY` (respaldo de plataforma opcional,
además del que se guarda en `platform_settings` desde `/plataforma/claves`).

Variables: copiar `.env.example` → `.env.local` (comentarios indican las del servicio n8n:
`AGEN_APP_URL`, `AGEN_WEBHOOK_SECRET`, gateways de notificación y marketing).

| Comando | Uso |
|---|---|
| `npm run dev` | Desarrollo en localhost:3000 |
| `npm run build` / `npm start` | Producción puerto 3010; health check `/api/health` |
| `npm run lint` / `npm run typecheck` | Verificación obligatoria |

**Despliegue:** EasyPanel sin Docker (build `npm ci && npm run build`, start `npm start`)
detrás del Worker Cloudflare `agen-web-router` (dominio `agen.synetia.site`, reescritura de
`Location`). Migraciones aplicadas en orden; workflows importados y activados solo tras
probarlos. Detalles en [`docs/EASYPANEL.md`](docs/EASYPANEL.md).
**Tests BD:** `supabase/tests/booking_invariants.sql` (transacción con rollback) verifica:
disponibilidad, aislamiento de especialidades, anti-solape, holds que bloquean, resize vs
holds, confirmación de hold y move con validación de compatibilidad.

## 8. Flujo de trabajo recomendado

1. Leer este archivo y el README antes de tocar nada.
2. UI: ubicar página en `src/app` + componentes; patrón `'use client'` + API propia
   (no llamar Supabase directo desde páginas salvo auth).
3. Lógica de negocio: reglas de integridad → SQL (funciones/triggers); orquestación → API
   route con helpers de `src/lib`.
4. Esquema: nueva migración numerada + actualizar seed/tests si aplica.
5. Agente: editar `n8n-workflows/01-agen-agent.json`; si cambia el contrato, sincronizar
   `/api/agent/*` y el README de n8n-workflows.
6. Antes de terminar: `npm run lint` y `npm run typecheck` en verde; si se tocó SQL, correr
   `booking_invariants.sql`.
7. Commits: conventional en inglés (`fix:`, `feat:`) como el historial.

## 9. Modo de trabajo (obligatorio)

- Trabajar en silencio: nada de narrar pasos internos, sin chat de relleno mientras se
  ejecutan herramientas. El texto visible debe limitarse a: una frase antes de empezar,
  avisos puntuales si algo cambia de rumbo o se traba, y un resumen final corto (qué se
  hizo, qué falta). Nada de explicaciones largas ni "voy a hacer X, ahora Y, ahora Z".
- Todo resultado se entrega terminado y verificado, nunca a medias: correr `npm run lint` y
  `npm run typecheck` (y `booking_invariants.sql` si se tocó SQL de reservas) antes de
  entregar. Si algo no se pudo probar, decirlo explícitamente — nunca presentarlo como
  verificado.
- Antes de entregar, usar las herramientas MCP disponibles (n8n, Supabase, etc.) para validar
  workflows, configuraciones y SQL cuando aplique.
- Para pasos técnicos que el usuario debe ejecutar él mismo (SQL, credenciales de un panel
  externo), dar la secuencia completa: qué archivo tocar, qué comando correr, qué configurar
  y en qué panel/botón exacto — nunca un comando suelto sin contexto de navegación. Si hay
  SQL, va completo en un bloque de código listo para copiar, con el orden de ejecución
  indicado (o la ruta exacta del archivo de migración si ya vive en el repo).
- No dejar nada a medias ni con pasos implícitos.

## 10. Push a este repositorio

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

## 11. Permisos generales

- Fuera del push descrito arriba, todo comando (Bash, edición de archivos, migraciones,
  etc.) sigue pidiendo permiso normal antes de ejecutarse. No hay modo "bypass" general.
