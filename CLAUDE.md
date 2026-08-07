# CLAUDE.md — Agen

Guía completa de arquitectura, convenciones, reglas de negocio y modo de trabajo de este
repositorio. Única referencia — no depende de ningún otro archivo de guía (incluye el Manual
Operativo de Desarrollo v1.0 fusionado). Incluye la sección 6.1 (capa de plataforma/super
admin, canales WhatsApp, voz, copiloto real, marketing con IA) añadida el 2026-08-05.

Agenda + Agente inteligente para negocios de servicios (peluquerías, estética, barberías).
Multi-tenant: cada negocio gestiona profesionales, servicios, agenda, clientes, cotizaciones,
campañas y seguimiento. Un agente IA (n8n + OpenAI) atiende clientes por WhatsApp u otros
canales y reserva vía la API de la app — nunca toca la base de datos directamente.

**Límite de alcance (no negociable):** este proyecto se originó como fork del roadmap de
MediCore, pero es un repo, una base de datos, un servidor y un n8n totalmente aparte y
propios de Agen (repo `ceuntabilo-a11y/AGEN`; n8n en `https://n8n-agen.synetia.site`, proyecto
EasyPanel `agen-prod`). MediCore (`dorian500-rgb/medicore`, otra cuenta de GitHub) solo se
puede **leer** como referencia si hace falta — nunca modificarlo, ni hacerle push, ni tocar su
n8n ni su base de datos. Ningún comando de este repo debe apuntar a infraestructura de
MediCore.

**Stack:** Next.js 15.5 App Router · React 18 · TypeScript estricto · Tailwind ·
Supabase (PostgreSQL + Auth + Storage) · n8n · PWA. Node 22 (engines >=20.9 <25).

## 0. Filosofía y estándar de calidad

El objetivo no es "terminar tareas" sino entregar soluciones production-ready: verificadas,
mantenibles, eficientes, robustas, escalables y de alta calidad — como el trabajo de un
equipo profesional. "Funciona" no es suficiente. Toda decisión busca mayor calidad, eficiencia
y estabilidad, menor deuda técnica y menor mantenimiento futuro, y mejor experiencia para el
usuario final (menos trabajo para él, automatización inteligente, sistema más simple, rápido,
estable e intuitivo). Nunca elegir la solución más rápida si existe otra claramente mejor: la
eficiencia se mide por valor entregado y ausencia de retrabajo, no por velocidad.

**Regla suprema, sin excepción:** prohibido inventar resultados, verificaciones, pruebas,
comportamientos, o afirmar que algo funciona sin haberlo comprobado. Nunca asumir, nunca
adivinar. Si algo no se pudo verificar, decirlo explícitamente (ver §9, "No verificado").
Prohibido usar "debería funcionar", "probablemente", "parece correcto", "quizás",
"posiblemente" — solo afirmar lo comprobado.

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
  Todo SQL para que el usuario ejecute manualmente va en un único bloque, sin nada adicional
  dentro, copiable directo, e indicando siempre si es reversible, si modifica datos, o si
  puede ser destructivo.
- Límites: `.limit()` en listados, recortes de longitud (notas 1000, títulos 120–160,
  resúmenes 4000), `normalizePhone()` en todos los teléfonos.
- **Código existente:** nunca modificar código estable sin entender por qué existe, qué hace
  y quién depende de él; si un cambio puede romper otra parte del sistema, verificarlo antes.
- **Duplicación/código muerto:** eliminar código duplicado solo si se investigó y se comprobó
  que no tiene efectos secundarios (si hay duda, reportarlo en vez de tocarlo); código muerto
  se informa (qué parece ser) sin borrarlo automáticamente si hay incertidumbre.
- **Dependencias:** agregar solo cuando aporten valor objetivo, mejoren eficiencia o
  mantenimiento, o sean práctica moderna ampliamente aceptada; nunca agregar innecesarias.

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
9. Si existe una solución arquitectónicamente superior a la actual, investigarla y
   proponerla primero — nunca implementarla automáticamente si cambia arquitectura,
   comportamiento, funcionalidades o estructura importante; se discute antes en el chat.

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
- Inventar resultados, verificaciones, pruebas o comportamientos (ver §0, Regla suprema).

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

## 6.2 Correo de marketing (Resend), cambio de cuenta y voz con texto libre

Añadido el 2026-08-05, investigado en MediCore y adaptado a Agen (ver
[[feedback-medicore-feature-parity]] en memoria).

- **Resend:** `src/lib/resend.ts` (`sendMarketingEmail`, `resendConfigured`). Clave única de
  plataforma (`platform_settings.resend_api_key`/`resend_from`, editable en
  `/plataforma/claves`; no hay clave por negocio, a propósito, igual que en MediCore). Usada
  por la rama `channel === 'EMAIL'` de `POST /api/admin/campaigns/send`: audiencia vía
  `resolveCampaignAudience` (ya filtra por `communication_consents` granted=true), un correo
  HTML simple por destinatario con link de baja (`marketing_unsubscribe_token` → `/unsubscribe`
  ya existente), log en `campaign_recipients` igual que la rama de WhatsApp. Sin clave
  configurada, `POST send` responde 503 con mensaje claro (no falla silencioso). Estado visible
  para el dueño del negocio (solo lectura) en `/admin/integraciones`.
- **Cambiar cuenta (varios profesionales en una sola PC):** `src/lib/accounts.ts` — patrón de
  MediCore: `localStorage` (`agen_cuentas`, máx. 6) guarda solo `{email,name,role,lastUsed}`,
  **nunca** contraseñas ni tokens. `LoginForm` llama `recordarCuenta()` tras un login exitoso y
  precarga el email si llega `?email=` en la URL. `AccountMenu` tiene "Cambiar cuenta": cierra
  la sesión actual y redirige a `/login?email=...` — siempre pide la contraseña de nuevo, no
  hay sesiones concurrentes reales (una sola sesión Supabase por navegador, como siempre).
- **Voz con texto libre:** `/admin/agente` → Voz ahora tiene un `<textarea>` (`previewText`,
  máx. 500 car.) en vez de una frase fija; `POST /api/admin/agent/voice-preview` recibe
  `{text}` en el body.

## 6.3 Avisos al cliente: envío real, motivo obligatorio y confirmación

Añadido el 2026-08-07 (`20260807000002_appointment_change_notices.sql`, aplicada).

- **La cola se envía desde la app, no desde un gateway externo.** El workflow 02 ya no manda
  nada a `AGEN_NOTIFICATION_GATEWAY_URL` (ese servicio nunca existió: ningún cliente recibía
  avisos). Ahora dispara `POST /api/automation/notifications/dispatch`, que reclama la cola,
  arma el texto con `src/lib/notification-templates.ts` y lo envía por `sendWhatsApp()` o por
  Resend según el canal. `claim/` y `result/` quedan por compatibilidad, ya no se usan.
- **Todo cambio se avisa con motivo y autor.** `cancel|reschedule|move|resize_safe_appointment`
  aceptan `p_reason`/`p_actor` (las firmas antiguas siguen existiendo y delegan). Encolan un
  evento `CHANGED` con `kind` (`CANCEL|RESCHEDULE|MOVE|RESIZE`), horas/profesional/duración
  antes y después, motivo y autor. `PATCH /api/admin/agenda` exige el motivo (400 sin él) y
  resuelve el autor con `resolveActorName` (nunca el correo interno).
- **Un aviso por cambio, no uno por tipo.** La unicidad de `notification_outbox` ahora solo
  aplica a los avisos programados (`REMINDER_*`, `CONFIRM_REQUEST`, `DAY_OF_REMINDER`), que se
  reprograman al mover la cita; los informativos se insertan siempre.
- **Confirmación en dos tiempos.** `schedule_appointment_reminders()` programa
  `CONFIRM_REQUEST` la tarde anterior (`settings.confirm_hour_day_before`) y `DAY_OF_REMINDER`
  la mañana del día (`settings.reminder_hour_same_day`), en la zona del negocio. Si el cliente
  responde que sí, el agente llama `confirmar_reserva` → `confirm_appointment_by_client()`:
  estado `CONFIRMED` + `appointments.client_confirmed_at`, y se borran los avisos pendientes.
  El dispatcher descarta avisos programados de citas ya confirmadas o no vigentes.
- **Liberar y lista de espera.** Si el cliente no puede, el agente llama `liberar_reserva`
  (`/api/agent/appointments`, acción `release`) y luego le ofrece horarios nuevos. Cancelar
  dispara `offer_freed_slot_to_waitlist()`: hasta 5 entradas `WAITING` del mismo servicio
  (mismo profesional o sin preferencia, dentro de su rango) reciben `WAITLIST_SLOT` y pasan a
  `CONTACTED`.
- Herramientas nuevas del agente en `01-agen-agent.json`: `mis_reservas`, `confirmar_reserva`,
  `liberar_reserva`, más las reglas 13–15 del prompt.

## 7. Entorno y despliegue

Variables nuevas: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (Evolution API compartida por la
plataforma para instancias por negocio), `OPENAI_API_KEY` (respaldo de plataforma opcional,
además del que se guarda en `platform_settings` desde `/plataforma/claves`), `RESEND_API_KEY`/
`RESEND_FROM` (respaldo — usar `/plataforma/claves` en vez de esto).

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

0. **Antes de escribir una sola línea de código:** entender completamente el requerimiento,
   investigar el proyecto y su arquitectura, leer todos los archivos relacionados, entender
   dependencias y flujo completo, y detectar posibles impactos. Recién después empezar.
   Evaluar también dificultad/tamaño/impacto/tiempo estimado y recomendar el modelo de Claude
   más eficiente para la tarea (no usar modelos muy potentes para tareas simples ni modelos
   chicos para trabajo arquitectónico complejo) — el objetivo es minimizar el costo TOTAL del
   desarrollo, no solo el de la conversación actual.
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

**Ante cualquier duda importante:** detenerse y preguntar en vez de asumir. Preguntas cortas,
numeradas, claras, simples, con ejemplo si ayuda — preguntar solo lo que de verdad no se puede
descubrir investigando.

**Una vez iniciada una tarea:** trabajar hasta completarla. Nada de código parcial, respuestas
a mitad de camino ni mensajes de avance — entregar solo cuando esté terminado. Si en el camino
aparecen bugs, deuda técnica, duplicaciones u otras oportunidades objetivas de mejora,
abordarlas o proponerlas: el objetivo es dejar siempre el proyecto mejor de como estaba,
pensando en rendimiento, escalabilidad y mantenibilidad a futuro (nunca soluciones que solo
sirvan para el estado actual).

## 9. Modo de trabajo (obligatorio)

- **Trabajar en silencio:** nada de narrar pasos internos ("Pensando...", "Analizando...",
  "Revisando...", "Estoy haciendo...", "Espera...", avisos de progreso/estado), sin chat de
  relleno ni mensajes intermedios mientras se ejecutan herramientas. El texto visible se
  limita a: una frase antes de empezar, avisos puntuales si algo cambia de rumbo o hay un
  bloqueo real que impide continuar, y el resumen final (formato abajo). Nada de frases de
  cortesía ("Claro", "Perfecto", "Excelente", "Con gusto", "Entendido") ni explicaciones de lo
  que se hizo, del razonamiento interno, o justificaciones de cambios — salvo que el usuario
  lo pida explícitamente. Ir directo al punto, con la menor cantidad de texto posible.
- **Verificar siempre antes de entregar**, nunca a medias: correr `npm run lint` y
  `npm run typecheck` (y `booking_invariants.sql` si se tocó SQL de reservas). Si se tocó UI,
  verificar funcionamiento, responsive, estilos y pantallas relacionadas; si se tocó backend,
  verificar endpoints, errores, respuestas e integración; si se tocó base de datos, verificar
  migraciones, consultas y compatibilidad; si existen tests, correrlos. Antes de responder,
  hacer una revisión final completa como si fuera un Pull Request (errores, regresiones,
  omisiones, inconsistencias, problemas de arquitectura o rendimiento) — si no quedó
  completamente verificado, no entregarlo. Si algo no se pudo probar, decirlo explícitamente
  en el resumen final (sección "No verificado": qué, por qué, qué falta) — nunca presentarlo
  como probado, y nunca usar "debería funcionar"/"probablemente"/similares (ver §0).
- **Orden obligatorio: local → probado 100% → commit → push.** Nunca subir a GitHub un cambio
  sin antes probarlo en el propio entorno: si toca UI/flujo de usuario, levantar
  `npm run dev` y usar la función de verdad en el navegador (no solo lint/typecheck, que no
  detectan bugs funcionales); si toca SQL/n8n, probarlo contra Supabase/n8n reales antes de
  darlo por bueno. Recién cuando quedó verificado al 100% se hace commit local, y recién
  después `git push`. El deploy a producción en EasyPanel (botón "Implementar") sigue siendo
  un paso manual del usuario, separado y posterior al push — nunca asumir que push = deploy.
- Antes de entregar, usar las herramientas MCP disponibles (n8n, Supabase, etc.) para validar
  workflows, configuraciones y SQL cuando aplique.
- **Investigar antes de improvisar.** Si la tarea toca algo con una forma correcta conocida de
  hacerse (un patrón de n8n, una integración, una API externa, una config de infraestructura),
  no adivinar: revisar primero si existe una skill para eso (`n8n`, `n8n-mcp-tools-expert`,
  `n8n-workflow-patterns`, etc.) y seguirla, o investigar la documentación oficial antes de
  escribir código. Si la tarea necesita una skill que no existe en este entorno, decirlo
  explícitamente ("esto necesitaría la skill X, no está instalada") en vez de improvisar una
  solución peor — así se puede instalar.
- **Guía para el usuario = nivel principiante total.** Cualquier paso que el usuario deba
  ejecutar él mismo (clic en un panel, pegar una clave, ejecutar SQL) se explica como si nunca
  hubiera usado esa herramienta: nombre exacto del botón/menú, en qué pantalla está, qué
  escribir literalmente, y qué debería ver después si funcionó. Nunca un comando o instrucción
  suelta sin ese contexto ("andá a Settings" no alcanza; hay que decir en qué URL/panel, qué
  clic exacto, y qué aparece en pantalla). Si hay SQL, va completo en un bloque de código listo
  para copiar y pegar, con el orden de ejecución indicado (o la ruta exacta del archivo de
  migración si ya vive en el repo). Objetivo: que la instrucción se pueda seguir sin entender
  nada técnico de fondo.
- **Minimizar lo que el usuario tiene que tocar.** Por defecto, Claude hace todo lo que se
  pueda hacer por API/CLI/MCP (código, git, Supabase, n8n — ver regla de n8n abajo) y solo pide
  al usuario los pasos que de verdad requieren su cuenta/su clic (crear una clave, aprobar un
  pago, confirmar algo irreversible). Nunca pedirle que haga a mano algo que Claude puede hacer
  con las herramientas que tiene.
- No dejar nada a medias ni con pasos implícitos.
- **Si el usuario pregunta por tareas futuras:** dar una estimación lo más cercana posible a
  la realidad, considerando complejidad, modelo a utilizar y tamaño del proyecto.

### Formato de entrega final

Siempre usar exactamente este formato al terminar una tarea:

```
## Hecho
- ...

## Verificado
- ...

## Archivos modificados
- ruta/archivo1

## Pendiente del desarrollador
- ...

## Riesgos encontrados
- ...

## Mejoras recomendadas
- ...

## No verificado
(Solo si aplica: qué, por qué, qué falta)
```

## 9.1 n8n: Claude administra, el usuario nunca entra a tocar nada

El usuario no debe abrir n8n para importar, editar ni configurar workflows — eso es trabajo de
Claude, hecho por la API REST de n8n (`PUT/POST /api/v1/workflows/...`), disponible en cuanto
existan estas dos variables:

- `N8N_API_URL` (ej. `https://n8n-agen.synetia.site`)
- `N8N_API_KEY` (se genera una sola vez, ver abajo)

**Guardarlas en `.env.local`** (nunca commitear, ya está en `.gitignore`) para que Claude las
lea de ahí con `Bash` y llame la API de n8n directamente — no requiere pegarlas en el chat cada
vez. Si el usuario prefiere pegarlas una vez en el chat, Claude las guarda igual en
`.env.local` y no las vuelve a pedir.

**Cómo generar la API key la primera vez (5 minutos, una sola vez):**
1. Abrir `https://n8n-agen.synetia.site` en el navegador y entrar con su usuario/contraseña de
   n8n (si nunca configuró una cuenta ahí, la primera vez n8n pide crear el usuario admin:
   nombre, correo y contraseña — cualquiera sirve, es solo para este panel).
2. Arriba a la izquierda, hacer clic en el círculo/ícono con su nombre o inicial (esquina
   inferior izquierda del menú lateral).
3. En el menú que aparece, hacer clic en **"Settings"**.
4. En el menú de la izquierda de Settings, hacer clic en **"n8n API"**.
5. Hacer clic en el botón **"Create an API key"** (o "Crear una clave API").
6. n8n muestra una clave larga que empieza con letras/números — hacer clic en el botón de
   copiar al lado de la clave (⚠️ solo se muestra una vez, si se cierra la pantalla sin
   copiarla hay que crear otra).
7. Pegar esa clave en el chat con Claude, junto con la URL (`https://n8n-agen.synetia.site`).
   Claude la guarda en `.env.local` y desde ahí administra los workflows sin volver a pedir
   nada.

Después de esto, cualquier cambio a `n8n-workflows/*.json` lo sube Claude directo al n8n real
por API, lo prueba, y recién ahí lo activa — el usuario solo se entera por el resumen final.

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