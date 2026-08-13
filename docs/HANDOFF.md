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
| HEAD local | `b66e2f9` — fix: the fast contract gate no longer needs a production build |
| HEAD remoto | `b66e2f9` (sincronizado) |
| Commits por delante de `main` | 6 |
| Árbol de trabajo | **sucio** — 7 archivo(s) |
| PR abierto | [#1](https://github.com/ceuntabilo-a11y/AGEN/pull/1) — Cierre/agente idempotencia ci (listo) |
| Último CI | completed / **failure** — https://github.com/ceuntabilo-a11y/AGEN/actions/runs/31738576461 |

Archivos sin commitear:

```
M .claude/skills/safe-local-autonomy/SKILL.md
 M CLAUDE.md
 M package-lock.json
 M package.json
 M scripts/dev-restart.mjs
?? .claude/skills/playwright-cli/
?? public/brand/synetia-logo.png
```

Últimos commits:

```
b66e2f9 fix: the fast contract gate no longer needs a production build
3350762 ci: add a fast contract gate, a dependency audit and round-the-clock monitoring
cbb97be fix: make notices and campaign sends impossible to duplicate
18c7c30 fix: one identity and one truth for every agent message
b6fca04 chore: add safe local autonomy policy
111639b fix: harden agent context and time handling
```

<!-- AUTO:FIN -->

---

## Qué está hecho

- **Fallo del CI del PR #1 corregido.** El job "Contrato del agente (rápido)" fallaba con
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

1. Multimedia y voz del agente (`/api/agent/media`, `/api/agent/voice/reply`) — probar de punta
   a punta con WhatsApp real.
2. Batería conversacional del agente (casos reales, no solo contrato).
3. Auditoría Playwright completa por roles (`platform`, `admin`, `professional`, `client`).
4. Idempotencia global del portal.
5. Health monitor con autorreparación.
6. Aislamiento sandbox / producción.
7. Observabilidad.
8. Latencia.
9. Rollback automático.
10. Approval Gateway.
11. Automatización 24/7.

## Riesgos abiertos

- El job `verificar` del CI (lint, typecheck, build y E2E) **nunca ha llegado a correr** en el
  PR #1: dependía del job de contrato, que fallaba antes. La primera vez que corra puede
  destapar fallos propios (secrets, E2E contra el build de producción).
- `DIALOG360` sigue sin verificarse con un envío real (ver `CLAUDE.md` §6.1).

## Siguiente comando exacto

```bash
npm run handoff
```

Y para retomar el ciclo de CI (ajusta el número de run al que aparezca en el bloque
automático):

```bash
gh run watch <ID_DEL_RUN> --repo ceuntabilo-a11y/AGEN
gh run view <ID_DEL_RUN> --repo ceuntabilo-a11y/AGEN --log-failed
```

Verificación local obligatoria antes de cualquier push:

```bash
npm run lint
npm run typecheck
npm run test:contrato
```
