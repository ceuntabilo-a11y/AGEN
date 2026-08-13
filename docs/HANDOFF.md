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
| HEAD local | `9b2d46b` — test: pin the two guarantees of the agent's voice and media |
| HEAD remoto | `9b2d46b` (sincronizado) |
| Commits por delante de `main` | 8 |
| Árbol de trabajo | **sucio** — 3 archivo(s) |
| PR abierto | [#1](https://github.com/ceuntabilo-a11y/AGEN/pull/1) — Cierre/agente idempotencia ci (listo) |
| Último CI | completed / **success** — https://github.com/ceuntabilo-a11y/AGEN/actions/runs/31744437699 |

Archivos sin commitear:

```
M docs/HANDOFF.md
?? .claude/skills/playwright-cli/
?? public/brand/synetia-logo.png
```

Últimos commits:

```
9b2d46b test: pin the two guarantees of the agent's voice and media
8389cf2 fix: unblock the production job of the CI and the local build
b66e2f9 fix: the fast contract gate no longer needs a production build
3350762 ci: add a fast contract gate, a dependency audit and round-the-clock monitoring
cbb97be fix: make notices and campaign sends impossible to duplicate
18c7c30 fix: one identity and one truth for every agent message
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

## Qué falta — backlog maestro

En orden acordado. Ninguno empezado salvo donde se indique.

1. Multimedia y voz del agente — la lógica de decisión ya está cubierta por contrato (ver
   arriba). **Falta la prueba de punta a punta con WhatsApp real**, y para eso hace falta una
   clave de DashScope cargada en `/plataforma/claves` o en el negocio, y encender
   `feature_image` / `feature_voice` en el negocio de pruebas. Eso es una decisión y una
   credencial del usuario, no algo que se pueda resolver desde el repositorio.
2. Batería conversacional del agente (casos reales, no solo contrato).
3. Auditoría Playwright por roles. **Ya existe una base que corre en CI y en local**: 85
   pruebas repartidas en `tests/e2e/{platform,admin,professional,client}`, con login real por
   rol y sesión guardada. Cubren carga sin errores de las páginas de cada panel, límites de
   acceso cruzados (cada rol rebotado de los paneles ajenos), agenda, catálogo y configuración
   del admin, y el flujo de reserva del portal del cliente incluido el "por qué no hay horas".
   Lo que falta es ampliarla, no crearla: flujos de escritura de punta a punta (crear y mover
   una reserva de verdad), responsive, y los paneles de plataforma más allá de la carga.
4. Idempotencia global del portal.
5. Health monitor con autorreparación.
6. Aislamiento sandbox / producción.
7. Observabilidad.
8. Latencia.
9. Rollback automático.
10. Approval Gateway.
11. Automatización 24/7.

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
