# Estado de AGEN — punto de retoma

Este archivo existe para que **una sesión nueva continúe sin reconstruir nada**. Si vas a
empezar a trabajar en AGEN, léelo antes que cualquier otra cosa (después de `CLAUDE.md`).

Cómo mantenerlo:

- `npm run handoff` refresca el bloque automático (rama, commits, PR, CI). Ejecútalo **después
  de cada push** y antes de terminar una sesión.
- Las secciones manuales las escribe quien trabaja. Regla: si algo no se deduce del
  repositorio, va aquí; si se deduce, va en el bloque automático.

---

## Estado del repositorio

<!-- AUTO:INICIO -->

> Bloque generado por `npm run handoff`. No lo edites a mano: se sobrescribe.

| Dato | Valor |
|---|---|
| Rama | `fix/version-sin-git` |
| HEAD local | `e56f55d` — test: prove that a duplicated webhook answers once, not twice |
| HEAD remoto | `e56f55d` (sincronizado) |
| Commits por delante de `main` | 5 |
| Árbol de trabajo | **sucio** — 3 archivo(s) |
| PR abierto | ninguno |
| Último CI | completed / **success** — https://github.com/ceuntabilo-a11y/AGEN/actions/runs/31852817027 |

Archivos sin commitear:

```
M docs/HANDOFF.md
?? .claude/skills/playwright-cli/
?? public/brand/synetia-logo.png
```

Últimos commits:

```
e56f55d test: prove that a duplicated webhook answers once, not twice
81b2317 test: the write cycle of team, campaigns, follow-ups and finance
e781049 fix: the agent was telling clients the wrong day and the wrong hour
bd63895 perf: the agent asks the app for its context once, not twice
4170e01 fix: identify the deployed version when the build has no git
8b79959 docs: close out the session — what is green, what is live, and what is not (#12)
```

<!-- AUTO:FIN -->

---

## Sesión del 2026-08-14 (tarde): el agente no le contestaba a nadie

Lo más importante de esta sesión, y lo que cambia el veredicto de venta.

**Estado al cerrar (actualizado tras el despliegue):** todo mergeado en `main` (PR #8 a #14,
todos con CI verde). En local, 434 pruebas de contrato y 606 E2E en verde. Los cuatro workflows
de n8n activos y comprobados funcionando.

**El despliegue ya se hizo** y `/api/agent/escalate` responde en producción, así que los
arreglos del agente están vivos. Lo comprobado después de desplegar está en la sección
"Verificado contra producción" de más abajo.

**Lo que quedó pendiente de un segundo despliegue** (todo está en `main`, nada de esto está
vivo aún): el contexto del agente en una sola llamada, `/api/agent/context`, las horas sin zona
leídas en la del negocio, y los horarios que la app devuelve ya formateados. `npm run n8n --
subir` está **bloqueado a propósito** hasta que la ruta exista en producción, para no dejar al
agente llamando a un 404. Los dos arreglos de conducta del agente (día y hora correctos, menos
turnos) **sí están vivos**, subidos por `npm run n8n -- prompt` y `-- herramienta`, que no
dependen del despliegue de la app.

### Lo que estaba roto y ahora está arreglado

1. **El agente no contestaba a NINGÚN cliente.** En las 100 ejecuciones más recientes del
   workflow 01 —siete horas seguidas— cero llegaron al modelo. Después del nodo `Esperar` (la
   pausa de 3 s que agrupa mensajes), n8n pierde el emparejado de items y `$('Entrada').item`
   deja de resolver: `Agrupar` mandaba un cuerpo vacío a `/api/agent/inbox`, recibía 400 y el
   flujo se iba por "Ya respondió otro". Corregido con `.first()` en los 36 sitios.
2. **Reservar fallaba aunque el modelo lo hiciera todo bien.** n8n entrega los argumentos del
   modelo de cuatro formas distintas y la herramienta leía una. Ahora el preámbulo común vive
   en `n8n-workflows/preambulo-herramientas.js` y se inyecta con
   `npm run n8n -- herramientas`.
3. **Nada acotaba el tiempo.** Ningún HTTP Request tenía `timeout` y el defecto de n8n son
   300 s; `Enviar a WhatsApp` reintentaba 3 veces → hasta 15 minutos. De ahí salían las
   interacciones de ~8 minutos. Ahora todo tiene techo.
4. **El modelo pensó en voz alta delante del cliente** (en inglés, citando sus reglas y sus
   herramientas). `revisarRespuesta` lo bloquea y manda la respuesta de respaldo.
5. **"¿Quieres que avise al equipo?" no avisaba a nadie.** Ahora `/api/agent/escalate` marca
   el hilo como `HUMAN`, deja un mensaje de sistema y crea un aviso por persona de recepción.
6. **"Mi agenda" no era una agenda**, era una lista. Ahora es un calendario con vista Día y
   Semana, eje de horas, citas a escala, descansos, bloqueos y huecos libres.
7. **AGEN 04 parecía muerto**: `saveDataSuccessExecution: "none"` hacía que sus ejecuciones
   correctas no se registraran. Llevaba horas funcionando y era imposible saberlo.
8. **Crear un servicio dependía de ganarle una carrera a la red**: el modal no contaba que
   estaba cargando el catálogo ni avisaba si fallaba.

### Verificado de punta a punta con WhatsApp REAL (no simulado)

Conversación completa contra el número del dueño, con entrega confirmada (`sent:true`) y
estado comprobado en la base después de cada paso:

| Paso | Resultado |
|---|---|
| Consultar servicios | catálogo real con precios, entregado |
| Consultar disponibilidad | 3 horarios con apartado, entregado |
| Reservar | `booked=true`, fila en `appointments`, `source=AI_AGENT` |
| Ver en la agenda del profesional | aparece el lunes 17 a las 09:00, en su hora |
| Confirmar | `CONFIRMED` + `client_confirmed_at` |
| Liberar | `CANCELLED` y ofrece horarios nuevos |
| Escalar sin endpoint desplegado | dice la verdad: "no pude avisar al equipo" |

### Verificado contra producción DESPUÉS del despliegue

| Qué | Resultado |
|---|---|
| Escalación real | `escalated:true`, `notified:1`; hilo en `HUMAN`, mensaje `SYSTEM` en el hilo y aviso en `team_notifications` con el nombre y el teléfono del cliente |
| Escalación repetida | `alreadyDone:true`, **un solo aviso** en la base, y el agente dice "el equipo ya tiene tu solicitud" en vez de repetir |
| Webhook duplicado | dos entregas del mismo `messageId` → **una sola respuesta**: la segunda ejecución sale sin contestar |
| "Ok" sin contexto | pregunta una vez, en una línea |
| "No sé" | decide él: propone el primer horario disponible, con día y hora correctos |
| "Después" | una línea amable, deja la puerta abierta y no insiste |
| Día y hora de los horarios | "Lunes, 17 de agosto — 09:45", correcto tras el arreglo (antes decía "martes 17 a las 13:00") |
| `/api/health` | 230 ms en caliente; 2,5 s en frío, de los cuales 1,3 s son DNS |

**Dos fallos encontrados así, que ninguna prueba anterior habría visto**: el agente daba el día
y la hora equivocados (convertía UTC a mano), y pedía disponibilidad con horas sin zona. Los dos
arreglados en la app y en la herramienta de n8n; la parte de la herramienta ya está viva.

### Latencia del agente, medida por nodo (no estimada)

Turno con reserva, 38 s en total: modelo 4,5 s + 13,3 s · `buscar_horarios` 3,5 s · espera de
agrupación 3 s (por diseño) · primer nodo de código 2 s (arranque del task runner de n8n,
infraestructura) · cada llamada a la app ~0,6 s. **Lo que queda por bajar es el modelo**, que
es la mitad del tiempo: el prompt del sistema son ~9 000 caracteres más el catálogo completo
en cada turno.

`/api/health` en producción: 235 ms en caliente. Los 1331 ms que se veían eran DNS + TLS de un
proceso recién arrancado, no la ruta (4 ms de mediana contra el build local). El monitor ahora
hace una petición de calentamiento que no cuenta para el presupuesto.

### Voz (DashScope), probada de verdad

`/api/admin/agent/voice-preview` devuelve un WAV real: 142 124 bytes, cabecera `RIFF`/`WAVE`,
en 4,7 s la primera vez y 2,9 s la segunda. Texto vacío → 400 con mensaje en español.

### Autonomía: tres envolturas nuevas

Cada popup que apareció se trató como una regresión y se cerró de raíz, no comando a comando:

- `npm run git -- <orden>` — ciclo git rutinario con lista blanca. No existe orden destructiva.
- `npm run n8n -- <orden>` — administrar el n8n real, ver latencia por nodo, ver qué contestó
  el agente, probar un disparador programado sin esperar a su hora.
- `npm run db -- <orden>` — consultas de solo lectura, con enmascarado de credenciales.

Y en las que ya existían: `pr-crear-md` (cuerpo del PR por archivo),
`app -- limpiar-temporales`, `app -- prod-perfil`, `git -- integrar-main`.

---

## Qué está hecho

- **CI del PR #1 en verde por primera vez** (run 31740001443, commit `8389cf2`): los dos jobs
  pasan y las 261 pruebas E2E corren de verdad contra el build de producción — 172 de contrato
  + 4 de login por rol + 85 por rol.
- **Segundo fallo del CI corregido:** `npm audit --omit=dev --audit-level=high` cortaba por
  nanoid 3.3.16 (GHSA-2v37-7h3g-55p8), que llega a producción por `next → postcss`. Subido a
  3.3.18 solo en `package-lock.json` (entra en el `^3.3.16` que ya declaraba postcss, así que
  `package.json` no cambia).
- **Multimedia y voz con pruebas de contrato** (`tests/contract/agente-voz.spec.ts`,
  `agente-multimedia.spec.ts`, 19 pruebas): queda fijado que la voz nunca devuelve
  `speak:false` + `sendText:false` (el agente no puede quedarse mudo), que en modo equipo jamás
  habla, y que `feature_image` / `feature_voice` son opt-in por negocio y sin clave el agente
  sigue como si el mensaje fuera solo texto. Ninguna toca la red.
- **Primer fallo del CI corregido.** El job "Contrato del agente (rápido)" fallaba con
  `Could not find a production build in the '.next' directory`: `playwright.config.ts` levantaba
  el `webServer` (`npm start`) con solo mirar `process.env.CI`, y ese job corre sin build y sin
  secrets a propósito. Ahora el servidor solo se levanta si la ejecución incluye algún project
  que lo necesite (`PROJECTS_SIN_SERVIDOR` en `playwright.config.ts`).
- **Pruebas de contrato ejecutables en Windows.** `npx playwright` cargaba dos copias de
  Playwright (`E:\AGEN\…` y `E:\agen\…`, la caché de módulos de Node distingue mayúsculas) y
  fallaban las 172. Los scripts `test:contrato` / `test:e2e` invocan el CLI local y cargan una
  sola copia.
- **Autonomía local afinada.** `.claude/settings.local.json`: el ciclo git normal, `gh` de
  lectura, las variables temporales delante del comando y las pruebas ya no abren diálogo; lo
  destructivo sigue en `deny`. Reflejado en `CLAUDE.md` §10/§11 y en la skill
  `safe-local-autonomy`.
- **`gh` instalado y autenticado** (2.97.0, vía winget), usando el token que ya tenía Git
  Credential Manager. Scopes: `gist`, `repo`, `workflow`. **Falta `read:org`**, así que
  `gh pr view` (GraphQL) falla: usar la API REST (`gh api repos/…`).

## Backlog maestro — estado real

Esta lista la lee `npm run watchdog`, así que las marcas importan:
`- [x]` hecho · `- [ ]` pendiente y se puede seguir solo · `- [!]` esperando al dueño (una
credencial o una decisión que nadie más puede tomar).

- [!] 1. Multimedia y voz del agente — la lógica de decisión ya está cubierta por contrato (ver
      arriba). **Falta la prueba de punta a punta con WhatsApp real**, y para eso hace falta una
      clave de DashScope cargada en `/plataforma/claves` o en el negocio, y encender
      `feature_image` / `feature_voice` en el negocio de pruebas. Eso es una decisión y una
      credencial del usuario, no algo que se pueda resolver desde el repositorio.
- [x] 2. **Batería conversacional — hecha.** `tests/contract/agente-conversacion.spec.ts`: seis
      conversaciones completas contra las rutas reales (reserva de punta a punta, cupo ocupado,
      el modelo saltándose el apartado, equipo, grupo de WhatsApp, cliente repetido) más once
      pruebas que fijan las reglas del prompt del workflow 01. Falta la batería contra el modelo
      de verdad, que necesita OpenAI y n8n reales.
- [x] 3. **Auditoría por roles — ampliada.** Ya había 85 pruebas por rol (carga de páginas, límites
      de acceso cruzados, agenda, catálogo, configuración y el flujo de reserva del portal).
      Ahora hay 43 más de responsive a 390×844 sobre las 35 páginas de los cuatro roles, que
      destaparon el desborde de cabecera. **Falta**: flujos de escritura de punta a punta (crear
      y mover una reserva de verdad), y para eso hace falta el punto 6 resuelto de verdad.
- [x] 4. **Idempotencia del portal — hecha donde había hueco.** `cancel_safe_appointment` no miraba
      el estado, así que cancelar dos veces avisaba dos veces y ofrecía el mismo cupo a otras
      cinco personas de la lista de espera. Corregido en
      `supabase/migrations/20260813000001_cancelacion_idempotente.sql`. Confirmar, reservar y
      `onboard` ya eran idempotentes; están revisados uno por uno.
      **Migración aplicada en producción el 2026-08-13** y `booking_invariants.sql` ejecutado
      sin errores contra la base real: las ocho invariantes pasan, incluida la que prueba que
      cancelar dos veces deja un solo aviso y contacta a una sola persona de la lista de espera.
- [x] 5. **Health monitor con autorreparación — hecho.** El monitor reintenta 3 veces antes de dar
      algo por caído (un microcorte ya no abre incidencia) y, cuando la salud vuelve, la
      incidencia del corte anterior se cierra sola. Reparar el servicio sigue siendo manual: eso
      es despliegue, no monitorización.
- [!] 6. **Aislamiento sandbox / producción — hecha la guarda, falta la infraestructura.**
      `exigirSandbox()` impide que una prueba de escritura toque un negocio que no sea el de
      pruebas. Pero sandbox y producción **comparten el proyecto de Supabase** y solo los separa
      `business_id`. El aislamiento de verdad son dos proyectos, y crear el segundo y cargar sus
      claves es del dueño.
- [x] 7. **Observabilidad — hecha.** `src/lib/observabilidad.ts` registra una línea JSON por evento
      en los puntos donde el agente fallaba en silencio. Falta enviar esos logs a algún sitio con
      búsqueda y retención (hoy quedan en los logs del contenedor de EasyPanel).
- [x] 8. **Latencia — hecha la medición.** Presupuesto por ruta en el monitor; superarlo se marca
      como `lento` sin abrir incidencia. Falta medir el tiempo de respuesta del agente de punta a
      punta, que se mide en n8n y no acá.
- [x] 9. **Rollback — hecha la parte que no necesita credenciales.** `npm run rollback` dice a qué
      commit volver (el último con CI verde) y da los comandos exactos. **No puede revertir ni
      desplegar solo**: el despliegue es un clic manual en EasyPanel, así que un rollback
      automático de verdad exige antes automatizar el despliegue, y eso necesita credenciales de
      EasyPanel.
- [x] 10. **Approval Gateway + watchdog — hecho.** Es la puerta de la automatización TÉCNICA,
       no del negocio: acá no se aprueban reservas, cancelaciones de clientes ni campañas.
       `npm run gateway -- "<acción>"` clasifica en `auto` (normal, segura, reversible),
       `bloqueado` (destructiva o irreversible: ni se ejecuta ni se pregunta) y `humano` (nada
       lo resuelve solo). La fuente de verdad es `.claude/settings.local.json`, no una segunda
       copia: `deny`→bloqueado, `ask`→humano, `allow`→auto, con precedencia deny > ask > allow.
       `npm run gateway -- --auditar` comprueba que la política sigue cumpliendo su propia
       definición. `npm run watchdog` mira el estado real del trabajo y dice qué hacer ahora,
       con código de salida para encadenarlo (0 terminado · 10 esperando CI · 20 hay trabajo ·
       30 falta una persona · 40 atascado).
- [!] 11. **Automatización 24/7 — el ciclo autónomo ya vive fuera de cualquier PC.**
       `.github/workflows/autonomia.yml` corre cada 15 minutos en GitHub Actions:
       detecta (salud de producción con reintentos + CI de main), actúa (revierte al último
       commit verde si main se puso en rojo), **valida antes de proponer** (lint, typecheck y
       contrato sobre el árbol revertido), recupera (empuja la rama y abre el PR, sin mergear
       nunca) y alerta (incidencia con etiqueta `autonomia`, que se cierra sola al recuperarse).
       La monitorización sigue aparte, cada 30 minutos, con el veredicto del watchdog en el log.
       **Probado corriendo de verdad el 2026-08-14**, ya en `main`: ejecución 31761876293 en
       simulación y 31762436097 en modo real (`aplicar: true`). Detectó `main` en `ca5567a` con
       CI `success`, sin alerta ni PR de reversión abiertos, y decidió `NADA` — ni PR espurio ni
       alerta espuria. Sin tocar ningún PC.
       **Lo que todavía no se ha visto correr:** la pierna de reversión. Solo se dispara si
       `main` se pone en rojo, y la regla de rama impide empujar un commit roto a `main` a
       propósito, así que esa parte está cubierta por las 13 pruebas de contrato y no por una
       ejecución real. Es la protección funcionando, no un hueco.
       **Falta un secreto:** `AGEN_APP_URL` no está configurado en el repositorio, así que
       `produccionSana` llega `null` y la pierna de salud nunca se evalúa. Ver "Pendiente del
       dueño".

## Verificado contra producción desplegada (2026-08-14)

Con el despliegue hecho y `AGEN_APP_URL` puesto, la vigilancia se ejecutó de verdad contra la
app real, no contra localhost:

- **Salud** (run 31772406225): `/api/health` 200 en 1331 ms, `/` 200 en 756 ms, `/login` 200 en
  169 ms. Producción responde. `/api/health` va por encima de su presupuesto de 800 ms, así que
  queda marcado como `lento` **sin abrir incidencia** — que es exactamente la conducta buscada:
  degradación no es caída. Vale la pena mirar por qué tarda: es una ruta que solo devuelve un
  JSON fijo.
- **Ciclo autónomo** (run 31772458925, modo real): `produccionSana: true`, `ciDeMain: success`,
  decisión `NADA`. La pierna de salud ya se evalúa; antes llegaba `null` por falta del secret.

## Lo que falta probar de verdad (no está hecho)

Estos puntos siguen sin verificarse en su entorno real. No están cubiertos por las pruebas
actuales y **no se deben dar por buenos**:

- ~~**Auditoría funcional completa por roles**~~ — **hecha**, con el ciclo completo
  (abrir → escribir → guardar → recargar → verificar → deshacer) de todo lo que se toca a
  diario: servicios, clientes, reservas desde el panel, reservas desde el portal del cliente,
  equipo y especialidades, campañas, seguimiento y finanzas.
  (`tests/e2e/admin/ciclo-*.spec.ts` y `tests/e2e/client/ciclo-reserva-portal.spec.ts`.)
  Encontró tres fallos reales de camino: el modal de servicios sin estado de carga, la
  redirección que cambiaba de host, y las pruebas de claves pisándose entre sí.
  **Lo que queda fuera a propósito**, porque tendría efectos fuera del sistema: dar de alta un
  profesional (manda una invitación por correo a una persona) y enviar una campaña.
  Ojo: estas pruebas ESCRIBEN, así que exigen `E2E_SANDBOX_BUSINESS_NAME` y **se saltan solas**
  sin él (ver "Pendiente del dueño": hay un solo negocio y es el de producción).
- ~~**Voz real con DashScope**~~ — **hecha el 2026-08-14**: WAV real de 142 124 bytes,
  cabecera `RIFF`/`WAVE`, 4,7 s en frío y 2,9 s después. Texto vacío responde 400 en español.
- ~~**n8n 01–04 funcionando**~~ — **comprobado el 2026-08-14**. 01 de punta a punta con
  WhatsApp real (ver arriba); 02 cada 2 minutos y 03 cada 5, con ejecuciones registradas; 04
  se disparaba bien pero no registraba nada (`saveDataSuccessExecution: "none"`), corregido y
  verificado con `npm run n8n -- probar-programado` (ejecución 7159, correcta en 1,6 s).
- ~~**WhatsApp de punta a punta**~~ — **hecho el 2026-08-14**, con entrega confirmada y estado
  comprobado en la base tras cada paso. El **mensaje duplicado** también está comprobado contra
  producción: dos entregas del mismo `messageId` (`npm run n8n -- probar … --id <id>`) producen
  una sola respuesta. **Falta** provocar de verdad una dependencia caída, que no se puede hacer
  sin tumbar algo real; sigue cubierto por contrato.
- **Pierna de reversión del ciclo autónomo.** Solo se dispara con `main` en rojo y la
  protección de rama impide provocarlo. Cubierta por pruebas de contrato, no por una ejecución.
- **Latencia del modelo.** Medida y acotada por arriba, pero no reducida. Y ya se sabe por qué
  no basta con recortar el prompt: `npm run n8n -- medir-prompt <idDeEjecucion>` dice que la
  entrada completa de un turno son **≈3 750 tokens** (2 250 del prompt del sistema, 650 del
  catálogo, 320 de las referencias temporales, el resto ficha y reservas). Con esa entrada,
  13 s de respuesta no se explican por el tamaño: **es la API de OpenAI**, no algo que se
  reestructure desde el repositorio. Lo que sí baja el total es reducir el número de llamadas
  al modelo por conversación, que es exactamente lo que hacen las reglas de turnos (P3).
  Un turno de reserva son hoy 2 llamadas al modelo, que ya es el mínimo.

  **Ya hecho, esperando despliegue:** `Cargar memoria` (1,6 s) y `Cargar catálogo` (0,9 s)
  corrían en secuencia siendo independientes. Ahora hay `/api/agent/context`, que los une en una
  llamada y por dentro va en dos oleadas, y la espera de agrupación baja de 3 s a 1,5 s. Entre
  las dos cosas se quitan de 3 a 4 segundos de cada turno — pero **no está vivo**: necesita el
  despliegue (ver "Pendiente del dueño", punto 6).

- **DIALOG360 — no es una dependencia activa.** El único negocio de la base usa `EVOLUTION`
  (`whatsapp_provider`), así que 360dialog no está en el camino de producción de nadie. La
  pantalla de Integraciones ya avisa de que no está verificado. No tiene sentido gastar en
  probarlo hasta que un negocio lo elija.

## Pendiente del dueño (nadie más puede hacerlo)

1. ~~Aplicar `20260813000001_cancelacion_idempotente.sql`~~ — **hecho el 2026-08-13**, con
   `booking_invariants.sql` ejecutado después sin errores contra la base real.
2. ~~Mergear el PR #1~~ — **hecho el 2026-08-14** (`ca5567a`).
3. ~~Crear el secret `AGEN_APP_URL`~~ — **hecho**: la monitorización ya evalúa producción.
4. ~~Clave de DashScope~~ — **hecha y probada** (audio real generado el 2026-08-14).
5. ~~Activar los workflows 02–04~~ — **los cuatro están activos y comprobados**.

### Lo único que bloquea de verdad, y por qué solo lo puedes hacer tú

6. ~~Desplegar en EasyPanel~~ — **hecho**: los arreglos del agente están vivos, comprobado con
   `npm run app -- prod-sondeo` (`/api/agent/escalate` responde 405, es decir existe) y con la
   escalación funcionando de verdad contra producción.

   **Hace falta UN despliegue más**, y es lo único que queda del lado de la aplicación. Está
   todo en `main` y nada de esto está vivo todavía:

   - el contexto del agente en una sola llamada (`/api/agent/context`), que quita entre 1,5 y
     2,5 s de cada turno;
   - las horas sin zona leídas en la del negocio (`instanteDelNegocio`), que evita que el
     agente busque en la franja equivocada;
   - los horarios que la app devuelve ya formateados en la zona del negocio.

   Cómo: **EasyPanel** → proyecto **`agen-prod`** → servicio de la **app web** (el que corre
   `npm start`, no Evolution ni n8n) → botón **"Implementar"**. Después, desde el repositorio:

   ```bash
   npm run app -- version                              # tiene que decir "al día con main"
   npm run n8n -- subir n8n-workflows/01-agen-agent.json
   ```

   Ese `subir` está **bloqueado a propósito** mientras la ruta no exista en producción: subir
   el workflow antes dejaría al agente llamando a un 404, que es un cliente sin respuesta. En
   cuanto la ruta esté, deja de negarse.

   Nota: en EasyPanel el contenedor de compilación no trae `.git`, así que `commit` sale
   `desconocido` en `/api/health`. Por eso existe la **huella** — un hash del código
   compilado— y `npm run app -- version` compara por ella cuando no hay commit.

7. **Segundo proyecto de Supabase, o al menos un segundo negocio de pruebas.** Hoy hay **un
   solo negocio** en la base (`Estética Bella Vida`) y es a la vez la demo, el sandbox y
   producción: el mismo tenant que recibe WhatsApp de clientes reales. Por eso las pruebas que
   escriben (`tests/e2e/admin/ciclo-servicio.spec.ts` y las que vengan) se saltan solas: sin
   `E2E_SANDBOX_BUSINESS_NAME` no tocan nada, a propósito.

   Lo mínimo que desbloquea la auditoría completa: crear un segundo negocio desde
   `/plataforma/negocios` (por ejemplo "Sandbox de pruebas"), y declarar su nombre exacto en
   `.env.test.local` y en los secrets del repositorio como `E2E_SANDBOX_BUSINESS_NAME`. Lo
   ideal sigue siendo un segundo proyecto de Supabase, pero un segundo tenant ya separa los
   datos de los clientes reales.

## Riesgos abiertos

- ~~Las pruebas E2E locales no arrancan solas~~ — **resuelto**: `npm run app -- e2e [proyecto]`
  pone `E2E_BASE_URL` por su cuenta y **no** pone `CI=1` (con `CI=1` Playwright levanta su
  propio servidor y choca con el que ya está). Usa `localhost` y no `127.0.0.1` a propósito:
  Next construye las redirecciones del middleware con `localhost`, así que entrando por la IP
  un redirect cambiaba de origen, la cookie no viajaba y tres pruebas de control de acceso
  fallaban por un bug que no existía.
- `DIALOG360` sigue sin verificarse con un envío real (ver `CLAUDE.md` §6.1).
- El token de `gh` de esta máquina (el de Git Credential Manager) tiene `gist`, `repo` y
  `workflow` pero **no `read:org`**, así que `gh pr view` / `gh pr checks` fallan por GraphQL.
  Usar la API REST: `gh api repos/ceuntabilo-a11y/AGEN/...`.

## Siguiente comando exacto

Empieza siempre por acá: dice qué hacer ahora y si el trabajo se detuvo.

```bash
npm run watchdog
npm run handoff    # y esto refresca el bloque de arriba
```

Verificación local obligatoria antes de cualquier push (§9 de CLAUDE.md):

```bash
npm run lint
npm run typecheck
npm run test:contrato
npm run app -- construir
npm run app -- arrancar
npm run app -- e2e
```

Para el ciclo de GitHub, sin escribir sintaxis que dispare diálogos:

```bash
npm run gh -- pr-crear-md          # cuerpo del PR en .pr/cuerpo.md
npm run gh -- pr-checks <n>
npm run gh -- pr-mergear <n>       # solo si TODOS los checks están verdes
npm run gh -- log <idDelRun>       # pasos fallidos
```

Para mirar el agente de verdad (esto es lo que encontró todo lo de esta sesión):

```bash
npm run n8n -- probar <businessId> "<mensaje>" "<telefono>"   # mensaje real por la misma puerta
npm run n8n -- dijo <idDeEjecucion>                            # qué contestó y qué hizo cada tool
npm run n8n -- lento <idDelWorkflow>                           # dónde se van los segundos
npm run db  -- buscar appointments id=<uuid>                   # comprobarlo en la base
```

Si `npm ci` falla con `EPERM ... next-swc.win32-x64-msvc.node`, es el servidor local:

```bash
npm run dev:detener
```
