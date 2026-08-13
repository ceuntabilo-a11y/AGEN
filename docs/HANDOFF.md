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
| Rama | `cierre/agente-idempotencia-ci` |
| HEAD local | `7c7e3bf` — feat: know which commit to roll back to, without guessing at 3am |
| HEAD remoto | `7c7e3bf` (sincronizado) |
| Commits por delante de `main` | 19 |
| Árbol de trabajo | **sucio** — 3 archivo(s) |
| PR abierto | [#1](https://github.com/ceuntabilo-a11y/AGEN/pull/1) — Cierre/agente idempotencia ci (listo) |
| Último CI | in_progress / **en curso** — https://github.com/ceuntabilo-a11y/AGEN/actions/runs/31751547693 |

Archivos sin commitear:

```
M docs/HANDOFF.md
?? .claude/skills/playwright-cli/
?? public/brand/synetia-logo.png
```

Últimos commits:

```
7c7e3bf feat: know which commit to roll back to, without guessing at 3am
e3d4493 feat: watch latency, and stop the monitor from failing when everything is fine
8aac2ec feat: the agent's silent failures now leave a trace
37cb9ba feat: a write test can no longer touch the wrong business
ca2808b feat: the monitor stops crying wolf and closes its own alert
fd523a4 fix: cancelling twice no longer warns twice nor drains the waitlist
```

<!-- AUTO:FIN -->

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

Los puntos 1 a 9 están hechos hasta donde se puede llegar desde el repositorio. Lo que queda
de cada uno, y los dos que no se pueden empezar, está detallado abajo con el motivo exacto.

1. Multimedia y voz del agente — la lógica de decisión ya está cubierta por contrato (ver
   arriba). **Falta la prueba de punta a punta con WhatsApp real**, y para eso hace falta una
   clave de DashScope cargada en `/plataforma/claves` o en el negocio, y encender
   `feature_image` / `feature_voice` en el negocio de pruebas. Eso es una decisión y una
   credencial del usuario, no algo que se pueda resolver desde el repositorio.
2. **Batería conversacional — hecha.** `tests/contract/agente-conversacion.spec.ts`: seis
   conversaciones completas contra las rutas reales (reserva de punta a punta, cupo ocupado,
   el modelo saltándose el apartado, equipo, grupo de WhatsApp, cliente repetido) más once
   pruebas que fijan las reglas del prompt del workflow 01. Falta la batería contra el modelo
   de verdad, que necesita OpenAI y n8n reales.
3. **Auditoría por roles — ampliada.** Ya había 85 pruebas por rol (carga de páginas, límites
   de acceso cruzados, agenda, catálogo, configuración y el flujo de reserva del portal).
   Ahora hay 43 más de responsive a 390×844 sobre las 35 páginas de los cuatro roles, que
   destaparon el desborde de cabecera. **Falta**: flujos de escritura de punta a punta (crear
   y mover una reserva de verdad), y para eso hace falta el punto 6 resuelto de verdad.
4. **Idempotencia del portal — hecha donde había hueco.** `cancel_safe_appointment` no miraba
   el estado, así que cancelar dos veces avisaba dos veces y ofrecía el mismo cupo a otras
   cinco personas de la lista de espera. Corregido en
   `supabase/migrations/20260813000001_cancelacion_idempotente.sql`. Confirmar, reservar y
   `onboard` ya eran idempotentes; están revisados uno por uno.
   **Pendiente del dueño: aplicar esa migración** (ver más abajo).
5. **Health monitor con autorreparación — hecho.** El monitor reintenta 3 veces antes de dar
   algo por caído (un microcorte ya no abre incidencia) y, cuando la salud vuelve, la
   incidencia del corte anterior se cierra sola. Reparar el servicio sigue siendo manual: eso
   es despliegue, no monitorización.
6. **Aislamiento sandbox / producción — hecha la guarda, falta la infraestructura.**
   `exigirSandbox()` impide que una prueba de escritura toque un negocio que no sea el de
   pruebas. Pero sandbox y producción **comparten el proyecto de Supabase** y solo los separa
   `business_id`. El aislamiento de verdad son dos proyectos, y crear el segundo y cargar sus
   claves es del dueño.
7. **Observabilidad — hecha.** `src/lib/observabilidad.ts` registra una línea JSON por evento
   en los puntos donde el agente fallaba en silencio. Falta enviar esos logs a algún sitio con
   búsqueda y retención (hoy quedan en los logs del contenedor de EasyPanel).
8. **Latencia — hecha la medición.** Presupuesto por ruta en el monitor; superarlo se marca
   como `lento` sin abrir incidencia. Falta medir el tiempo de respuesta del agente de punta a
   punta, que se mide en n8n y no acá.
9. **Rollback — hecha la parte que no necesita credenciales.** `npm run rollback` dice a qué
   commit volver (el último con CI verde) y da los comandos exactos. **No puede revertir ni
   desplegar solo**: el despliegue es un clic manual en EasyPanel, así que un rollback
   automático de verdad exige antes automatizar el despliegue, y eso necesita credenciales de
   EasyPanel.
10. **Approval Gateway — no empezado, falta definirlo.** Es el único punto del backlog cuyo
    alcance no se puede deducir del repositorio: no hay código, ni tabla, ni ruta que lo
    insinúe. Hace falta que el dueño diga qué aprueba y quién: ¿los despliegues a producción?
    ¿las acciones del agente por encima de cierto riesgo (cancelar, mover, cobrar)? ¿las
    campañas de marketing antes de salir? Cada respuesta es un sistema distinto.
11. **Automatización 24/7 — en pie la mitad.** La monitorización corre cada 30 minutos en
    GitHub Actions y los workflows de n8n atienden WhatsApp. Lo que falta es de infraestructura
    y del dueño: activar y vigilar los workflows 02–04 en el n8n real, y decidir qué pasa
    cuando la automatización detecta algo (hoy: abre una incidencia y espera a una persona).

## Pendiente del dueño (nadie más puede hacerlo)

1. **Aplicar la migración `20260813000001_cancelacion_idempotente.sql`.** Entra en el panel de
   Supabase del proyecto de AGEN → menú izquierdo **SQL Editor** → botón **New query** → pega
   el contenido completo del archivo → botón **Run**. Debería responder `Success. No rows
   returned`. Es reversible, no modifica datos y no borra nada. Hasta que se aplique, cancelar
   dos veces sigue avisando dos veces.
2. **Clave de DashScope** en `/plataforma/claves` si se quiere probar la voz de punta a punta.
3. **Segundo proyecto de Supabase** para separar de verdad sandbox de producción.
4. **Decidir el alcance del Approval Gateway** (punto 10 del backlog).

## Riesgos abiertos

- **Las pruebas E2E locales no arrancan solas**: `auth.setup.ts` se queda esperando
  `input[type="email"]` en `/login`. Pasa porque `.env.test.local` define un `E2E_BASE_URL` que
  no es el servidor local. Ejecutar siempre
  `CI=1 E2E_BASE_URL=http://localhost:3010 npm run test:e2e` — así corren y pasan las 261. En CI
  no ocurre: allí el valor lo pone el workflow. Vale la pena arreglar el `.env.test.local` o
  hacer que el valor del workflow sea el de por defecto.
- `DIALOG360` sigue sin verificarse con un envío real (ver `CLAUDE.md` §6.1).
- El token de `gh` de esta máquina (el de Git Credential Manager) tiene `gist`, `repo` y
  `workflow` pero **no `read:org`**, así que `gh pr view` / `gh pr checks` fallan por GraphQL.
  Usar la API REST: `gh api repos/ceuntabilo-a11y/AGEN/...`.

## Siguiente comando exacto

Para saber dónde está todo, empieza siempre por acá:

```bash
npm run handoff
```

El backlog está en verde y sin nada a medias, así que el siguiente paso es **elegir el punto 2
o el 3** y empezar. Verificación local obligatoria antes de cualquier push (§9 de CLAUDE.md):

```bash
npm run lint
npm run typecheck
npm run test:contrato
CI=1 E2E_BASE_URL=http://localhost:3010 npm run test:e2e
```

Para seguir el CI después de un push (el ID sale del bloque automático de arriba):

```bash
gh run view <ID_DEL_RUN> --repo ceuntabilo-a11y/AGEN
gh run view <ID_DEL_RUN> --repo ceuntabilo-a11y/AGEN --log-failed
```

Si `npm ci` falla con `EPERM ... next-swc.win32-x64-msvc.node`, es el servidor local:

```bash
npm run dev:detener
```
