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
| HEAD local | `0ff0890` — fix: the policy audit cannot run where the policy does not exist |
| HEAD remoto | `0ff0890` (sincronizado) |
| Commits por delante de `main` | 22 |
| Árbol de trabajo | **sucio** — 3 archivo(s) |
| PR abierto | [#1](https://github.com/ceuntabilo-a11y/AGEN/pull/1) — Cierre/agente idempotencia ci (listo) |
| Último CI | completed / **success** — https://github.com/ceuntabilo-a11y/AGEN/actions/runs/31754341917 |

Archivos sin commitear:

```
M docs/HANDOFF.md
?? .claude/skills/playwright-cli/
?? public/brand/synetia-logo.png
```

Últimos commits:

```
0ff0890 fix: the policy audit cannot run where the policy does not exist
ea5b0e4 feat: an approval gateway for the technical automation, plus a watchdog
13cc34a docs: record where each backlog item really stands
7c7e3bf feat: know which commit to roll back to, without guessing at 3am
e3d4493 feat: watch latency, and stop the monitor from failing when everything is fine
8aac2ec feat: the agent's silent failures now leave a trace
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
      **Pendiente del dueño: aplicar esa migración** (ver más abajo).
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
- [!] 11. **Automatización 24/7 — hecho el lado del repositorio.** La monitorización corre cada
       30 minutos, reintenta antes de alarmar, cierra sola su incidencia cuando la salud vuelve
       e imprime el veredicto del watchdog en cada ejecución. Con eso, el estado del trabajo y
       el de producción quedan vigilados sin que nadie mire la pantalla.
       **Falta lo que es del dueño:** activar y vigilar los workflows 02–04 en el n8n real, que
       no se puede tocar desde este repositorio.

## Pendiente del dueño (nadie más puede hacerlo)

1. **Aplicar la migración `20260813000001_cancelacion_idempotente.sql`.** Entra en el panel de
   Supabase del proyecto de AGEN → menú izquierdo **SQL Editor** → botón **New query** → pega
   el contenido completo del archivo → botón **Run**. Debería responder `Success. No rows
   returned`. Es reversible, no modifica datos y no borra nada. Hasta que se aplique, cancelar
   dos veces sigue avisando dos veces al cliente y ofreciendo el mismo cupo a otras cinco
   personas de la lista de espera.
2. **Correr `supabase/tests/booking_invariants.sql`** en ese mismo SQL Editor después de aplicar
   la migración. Va dentro de una transacción con `rollback`, así que no deja nada.
3. **Mergear el PR #1** y después desplegar en EasyPanel (servicio de la app → "Implementar").
4. **Clave de DashScope** en `/plataforma/claves` si se quiere probar la voz de punta a punta.
5. **Segundo proyecto de Supabase** para separar de verdad sandbox de producción.
6. **Activar los workflows 02–04 en el n8n real**, que no se puede tocar desde este repositorio.

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
