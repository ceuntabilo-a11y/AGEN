---
name: safe-local-autonomy
description: Cómo ejecutar el trabajo local de AGEN (leer, esperar, probar, diagnosticar y editar dentro de E:\AGEN) sin interrumpir al usuario con diálogos de aprobación innecesarios. Usar siempre que se trabaje en AGEN, y en particular antes de pedir aprobación para cualquier operación puramente local, al esperar una suite de tests, al leer outputs de tareas en segundo plano, al ejecutar scripts Node locales o al editar código, tests, fixtures y workflows del repositorio.
---

# Autonomía local segura en AGEN

Esta skill regula **comportamiento**, no permisos. La autoridad técnica sigue siendo
`.claude/settings.local.json` (`allow` / `ask` / `deny`) y nada de lo que digas aquí puede
saltarse esas reglas. Lo que aporta es criterio: **cómo formular el trabajo local para no
interrumpir al usuario**, y cuándo interrumpirlo de verdad porque hace falta.

El objetivo es que una sesión de horas en `E:\AGEN` avance sola: leer, esperar, probar,
diagnosticar y editar sin pedir permiso; y reservar los diálogos para lo que cruza una
frontera real.

## El principio

Ejecuta sin pedir aprobación cualquier operación que cumpla **todas** estas condiciones:

- es exclusivamente local a `E:\AGEN` (o al scratchpad de la sesión);
- es reversible;
- no es destructiva;
- no modifica ningún sistema externo;
- no publica nada;
- no añade, elimina ni cambia dependencias declaradas;
- no expone secretos.

**Excepción — lectura externa ya autorizada.** También son rutinarias las operaciones
externas de **solo lectura** que `settings.local.json` autoriza de forma específica, como
consultar el estado de GitHub Actions del repositorio `ceuntabilo-a11y/AGEN` o los tags y
releases de `actions/*`. Esto **nunca** cubre `POST`, `PUT`, `PATCH`, `DELETE` ni ninguna
otra mutación externa: esas siguen bloqueadas por `deny`, aunque la URL esté permitida.

**Sobre dependencias.** `npm ci` con el lockfile existente **sí** es rutinario: materializa
`node_modules` a partir de `package-lock.json` sin tocar `package.json` ni el propio
lockfile. En cambio `npm install`, `npm uninstall` y cualquier modificación del grafo de
dependencias siguen en `ask`, se invoquen como se invoquen.

Si falla una sola condición y no encaja en la excepción, no es trabajo local rutinario:
aplica la regla de escalamiento.

## Estar dentro de E:\AGEN no hace segura una operación

La ubicación no es el criterio. Dentro del propio repositorio hay zonas que conservan sus
barreras y **no** se tocan por la vía rápida:

- `.env`, `.env.local`, `.env.production`, `.env.test.local` — ni leer en claro, ni editar.
- `.git/` y cualquier interno de git.
- `.claude/settings.local.json` y el resto de la configuración de permisos.
- `supabase/migrations/` ya aplicadas (CLAUDE.md §6: no se editan nunca).
- Cualquier archivo que contenga credenciales.

Editar `src/`, `tests/`, `scripts/`, `playwright/` o `n8n-workflows/` es trabajo local normal.
Tocar la lista de arriba no lo es, aunque el archivo esté en la misma carpeta.

## Trabajo que se hace sin preguntar

Lectura y espera: `cat`, `head`, `tail`, `grep`, `ls`, `wc` sobre código, logs, outputs de
tareas en segundo plano y cualquier archivo **no protegido** del proyecto —las zonas
protegidas definidas arriba siguen excluidas—; `sleep` y sondeos; bucles `until` / `while`
cuyo único fin sea esperar y leer un resultado.

Ejecución local: `node` y `node -e` para leer, analizar, validar y modificar archivos
controlados del repositorio; scripts `.mjs` locales; `npm ci`; Playwright
(`npx playwright *`, `playwright-cli *`); health checks y llamadas a `localhost`, incluidas
las APIs `/api/agent/*`, `/api/admin/*` y `/api/health`; consultas de solo lectura a GitHub
Actions del repositorio `ceuntabilo-a11y/AGEN` ya autorizadas.

Escritura local: crear y editar archivos dentro de `E:\AGEN` —código en `src/`, tests,
fixtures, `scripts/`, `playwright/`, `n8n-workflows/`— y en el scratchpad de la sesión.
El patrón habitual de validar una plantilla con Node y luego escribir
`n8n-workflows/01-agen-agent.json` es trabajo local normal: hazlo.

## `npm run` no es seguro por definición

`npm run <algo>` ejecuta lo que diga `package.json`, y eso puede ser cualquier cosa.
**Antes de usar un script por primera vez, lee su contenido en `package.json`.**

Rutinarios una vez comprobados que son locales y no destructivos:

| Script | Qué hace |
|---|---|
| `lint` | `eslint .` |
| `typecheck` | `tsc --noEmit` |
| `build` | `next build` |
| `dev` | `next dev -p 3000` |
| `dev:restart` | reinicio acotado del dev (ver más abajo) |
| `dev:estado` | solo informa |

Si aparece un script de **deploy, migración, reset, publicación, importación a n8n o
cualquier mutación externa**, no es rutinario: queda sujeto a aprobación o bloqueado, aunque
se invoque con `npm run`. Un script nuevo que no hayas leído se trata como desconocido.

En AGEN **no existe un script `test`**: la suite se ejecuta con `npx playwright test`.

## Node no es una puerta trasera

`node`, `node -e` y los scripts locales están permitidos para trabajo local, **no** para
hacer por dentro lo que está en `ask` o `deny`. Un script local nunca debe:

- lanzar con `child_process` (o equivalente) comandos que estarían en `ask` o `deny`:
  `git add/commit/push`, `git reset --hard`, `git clean`, `rm`, `npm install`, `npx` que
  descargue paquetes, `psql`, deploy…;
- borrar archivos del proyecto;
- modificar `.git/`, `.env*`, `.claude/settings.local.json` ni migraciones ya aplicadas;
- realizar mutaciones externas de ningún tipo;
- acceder a MediCore ni a su base de datos o su n8n;
- enviar secretos fuera de `localhost`;
- modificar `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`,
  `packageManager` ni `package-lock.json` para evitar la aprobación de un cambio de
  dependencias;
- (sí puede editar otros campos de `package.json` —por ejemplo añadir un script local— cuando
  el cambio sea local, revisable y no altere el grafo de dependencias).

Si necesitas una de esas acciones, pídela por el canal normal. Envolverla en Node para que no
aparezca el diálogo es exactamente lo que no se debe hacer.

## Lo que sí hay que preguntar

`git add` · `git commit` · `git push` · `git mv` · `checkout` / `switch` / `merge` /
`rebase` / `revert` / `stash` / `tag` · cambios de `remote` · escrituras de `git config` ·
`npm install` / `uninstall` · cualquier cambio de dependencias · `npx` que descargue paquetes ·
`npm publish` · deploy · EasyPanel · importar o modificar el n8n real · `mv` cuando pueda
sobrescribir o sacar un archivo del repositorio · cualquier mutación externa o acción sobre
producción.

En estos casos **no reformules para esquivar el diálogo**: pertenecen legítimamente a `ask`.

## Lo que sigue bloqueado

`git push --force` · `reset --hard` · `git clean` · `git restore` · `filter-branch` ·
`rm` / `rmdir` / `del` / `Remove-Item` / `truncate` / `shred` / `dd` · `psql` y
`supabase db reset|push` · `DROP` / `TRUNCATE` / `DELETE FROM` · impresión o volcado de
secretos · mostrar `.env*` · volcar `process.env` · mutaciones directas de producción
(`agen.synetia.site`, `n8n-agen.synetia.site`, `supabase.co`) · cualquier operación sobre
MediCore desde AGEN · `curl` mutante hacia destinos externos.

**Sobre `fs.unlinkSync`:** solo puede usarse para borrar archivos **temporales creados por la
propia tarea** dentro del scratchpad o del directorio temporal. Nunca para borrar código,
configuración ni ningún archivo preexistente del repositorio. No es un sustituto de `rm`:
el `deny` de borrado sigue vigente y Node no lo levanta.

## Secretos

Puedes cargar `.env.local` o `.env.test.local` con `process.loadEnvFile()` cuando hagan falta
para ejecutar AGEN contra `localhost`. Nunca los imprimas, no los copies a un log ni a un
mensaje, y no los envíes a ningún servicio externo. Para comprobar que una variable está
presente, informa solo `true` / `false` o su longitud.

## Casos concretos que no deben volver a interrumpir

Comprobados en esta base de código:

1. `cat "$TEMP/.../tasks/<id>.output"` para leer el resultado de una tarea en segundo plano.
2. `tail`, `head`, `grep` o `ls` sobre esos mismos outputs.
3. `sleep N` y comprobar después el resultado.
4. Un bucle `until` o `while` que solo espera a que termine una suite.
5. `node -e` que lee o modifica archivos locales controlados de `E:\AGEN`.
6. `node scripts/<algo>.mjs` para aplicar una modificación local controlada.
7. Validar plantillas, workflows y fixtures en local.

## Si el comando concreto provoca un diálogo

Que una operación inocua dispare un diálogo casi siempre es un problema de **forma**, no de
fondo. **No pidas aprobación de inmediato.** Reformula primero:

- separa las tuberías y los encadenados con `;` en varias llamadas simples;
- una llamada por comando, empezando cada una por un prefijo ya permitido;
- usa Node y `fs` para sondear o leer en vez de construcciones de shell raras;
- escribe un script local pequeño y revisable y ejecútalo con `node`;
- reutiliza los scripts de npm que ya hayas comprobado;
- evita las construcciones que confunden al matcher (ver más abajo).

**Nunca amplíes permisos solo para no ver una pregunta.** Reformular es la salida correcta;
tocar `deny` no lo es.

## Regla de escalamiento

Antes de mostrar un diálogo de aprobación por trabajo local:

1. clasifica la operación con el principio de arriba;
2. comprueba si de verdad cruza una frontera sensible (externo, publicación, dependencias,
   secretos, destructivo, producción, zonas protegidas del repositorio);
3. si no la cruza, prueba una alternativa ya permitida;
4. pide aprobación solo si no existe ninguna alternativa segura razonable.

Y al revés: si la operación pertenece de verdad a `ask` o `deny`, **no busques un rodeo**.
Pídela, o dile al usuario que está bloqueada y por qué.

## Cómo se comporta el matcher de permisos

Comprobado empíricamente en este repositorio:

- **Descompone los encadenados.** `ls package.json && git clean -n` queda denegado por la
  segunda parte, aunque la primera esté permitida.
- **Descompone también los cuerpos de bucle.** `for f in x; do git clean -n; done` queda
  denegado. Los bucles no son una vía para colar comandos prohibidos.
- **Los comodines intermedios funcionan** (`*.env*`, `*curl*`), pero no existe la negación:
  por eso el acceso de solo lectura a GitHub se garantiza con `deny` de los métodos mutantes,
  no con el patrón de `allow`.
- **Limitación conocida:** un `;` encadenado **después de una tubería** se evalúa como un
  bloque opaco y pide permiso —por ejemplo `npx playwright test | tail -3; echo ok; curl …`—.
  La solución es partirlo en llamadas separadas, no añadir comodines.

## Cómo esperar una suite sin interrumpir

Las suites de este proyecto tardan minutos:

- completa: `npx playwright test`
- solo contrato (rápida, sin navegador ni red): `npx playwright test --project=contrato`
- por rol: `npx playwright test --project=admin` (o `platform`, `professional`, `client`)

Patrón recomendado:

1. **si la herramienta permite ejecución en segundo plano, úsala** y guarda el identificador
   de la tarea; **si no, espera con comandos seguros ya permitidos** (`sleep` más una lectura
   posterior, o un bucle de espera que solo consulte el resultado);
2. mientras tanto sigue con trabajo que no toque el servidor de desarrollo;
3. lee el output con `cat` o `tail` cuando esté disponible.

Nunca dejes el turno bloqueado con una espera larga en primer plano ni sondees en bucle
apretado.

## Servidor de desarrollo

Reinícialo con `npm run dev:restart` y consulta su estado con `npm run dev:estado`. Ambos
usan `scripts/dev-restart.mjs`, cuyo alcance está grabado en el código: solo detiene procesos
`node.exe` que pertenezcan a este repositorio **y** sean de Next, con exclusión explícita de
MediCore. **No abras PowerShell ni `Stop-Process` por tu cuenta**: si hace falta más alcance,
amplía el script y explícalo, no el permiso.

Ten presente que `npm run build` sobrescribe `.next` y deja inservible un `npm run dev` que
estuviera corriendo: después de un build, reinicia el dev.

## Relación con las demás reglas

`CLAUDE.md` manda sobre arquitectura, calidad, verificación y modo de trabajo; esta skill solo
decide **cómo ejecutar** lo local. En particular siguen intactas: no inventar resultados ni
verificaciones (§0), verificar antes de entregar con `lint` y `typecheck` (§9), el orden
local → probado → commit → push (§9), y que commit y push requieren aprobación explícita
(§10, actualizado en este proyecto). Nada de lo que hay aquí autoriza a subir, desplegar ni
tocar producción.
