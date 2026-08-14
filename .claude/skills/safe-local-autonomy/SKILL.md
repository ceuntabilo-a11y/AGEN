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
controlados del repositorio; scripts `.mjs` locales; `npm ci`; Playwright por los scripts de
npm (ver más abajo por qué `npx playwright` no sirve en Windows); health checks y llamadas a
`localhost`, incluidas las APIs `/api/agent/*`, `/api/admin/*` y `/api/health`; el ciclo git
normal y la lectura del CI con `gh`.

Las variables temporales delante del comando (`CI=1 …`, `NODE_OPTIONS=… `, `PWTEST_CACHE_DIR=…`,
`E2E_*=…`, `AGEN_*=…`, `TZ=…`) están autorizadas explícitamente desde el 2026-08-13: ya no hay
que reescribir el comando para evitarlas.

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
| `test:contrato` | `playwright test --project=contrato` por el CLI local |
| `test:e2e` | `playwright test` por el CLI local |

Si aparece un script de **deploy, migración, reset, publicación, importación a n8n o
cualquier mutación externa**, no es rutinario: queda sujeto a aprobación o bloqueado, aunque
se invoque con `npm run`. Un script nuevo que no hayas leído se trata como desconocido.

En AGEN **no existe un script `test`**: la suite se ejecuta con `npm run test:e2e` y la rápida
con `npm run test:contrato`.

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

## Modo silencioso: se trabaja sin narrar

Regla de CLAUDE.md §9.2, y manda sobre cualquier otra indicación de estilo. Mientras algo
corre —una suite, el CI, el monitor, un agente— **se espera en silencio**. Nada de avisos de
progreso, mensajes de espera, estados repetidos ni informes intermedios. Solo se comunica un
bloqueo humano real o el informe final.

En la práctica, cuando hay que esperar: arma el monitor o la tarea en segundo plano y **no
escribas nada** hasta que llegue el resultado. Si la espera termina, sigue con el trabajo
siguiente sin anunciarlo.

## El ciclo git y el CI no interrumpen (desde el 2026-08-13)

`git add`, `git commit`, `git push` sin `--force`, `git branch`, `git switch`, `git fetch`,
y la lectura y gestión no destructiva del CI con `gh` (`gh run view/list/watch`,
`gh pr view/checks/status/create/edit`, `gh workflow view/list/run`) **corren sin diálogo**.

La red de seguridad no es la pregunta: es que `main` está protegida por regla de repositorio
—exige el check "Lint, typecheck, build y E2E"— y que el deploy en EasyPanel sigue siendo un
paso manual, aparte y posterior. Sigue vigente el orden de CLAUDE.md §9: **local → probado al
100% → commit → push**, y la regla de que un push solo puede contener lo que se pidió y se
conversó.

## Lo que sí hay que preguntar

`git mv` · `checkout` / `merge` / `rebase` / `revert` / `stash` / `tag` · añadir o cambiar un
`remote` · `git config --global` · `npm install` / `uninstall` · cualquier cambio de
dependencias · `npx` que descargue paquetes · `npm publish` · deploy · EasyPanel · importar o
modificar el n8n real · `mv` cuando pueda sobrescribir o sacar un archivo del repositorio ·
cualquier mutación externa o acción sobre producción.

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

### Falsos diálogos del analizador y su reformulación

Cuando el analizador no puede leer la FORMA del comando, pide permiso aunque la operación sea
trabajo local rutinario. **No es una frontera: es sintaxis.** Reformula y sigue; no preguntes.

Casos comprobados en este repositorio, con la salida correcta de cada uno:

| Síntoma del analizador | Qué lo dispara | Reformulación correcta |
|---|---|---|
| `Newline followed by # inside a quoted argument` | Un `node -e "…"` cuyo texto incrusta YAML, Markdown o código con saltos de línea seguidos de `#` (un comentario al principio de una línea) | Editar el archivo con la herramienta de edición directa, sin shell. Es lo que corresponde para cambiar `.github/workflows/*.yml`, `*.md` o cualquier archivo con comentarios `#` |
| `backtick_escape_unsupported` | Plantillas con `` ` `` dentro de comillas dobles en `node -e` | Script `.mjs` en el scratchpad ejecutado con `node ruta.mjs`, o edición directa |
| `simple_expansion` | `${variable}` dentro de la cadena que se le pasa a `node -e` | Igual: script en archivo, o edición directa |
| Diálogo al leer una ruta con corchetes | Rutas de Next.js como `src/app/admin/clientes/[id]/page.tsx` con `sed`/`cat` (los corchetes parecen un glob) | Leer con la herramienta de lectura de archivos, indicando la ruta completa |
| Diálogo con una variable de entorno delante del comando | `PWTEST_CACHE_DIR=… npx playwright test`, `AGEN_APP_URL=… node script.mjs`: el prefijo `VARIABLE=valor` hace que el comando ya no empiece por un prefijo permitido | Si la forma concreta ya está permitida (`E2E_BASE_URL=* npx playwright *`), úsala tal cual. Si no, **haz que el script acepte el valor como argumento** (`node scripts/monitor-salud.mjs http://127.0.0.1:3000`) o léelo dentro del script con `process.loadEnvFile()`. Es lo que se hizo en `scripts/monitor-salud.mjs` |
| Diálogo por `;` con `echo $?` al final | Encadenar el comando con `; echo "codigo=$?"` para ver el código de salida | Ejecutar el comando solo: el resultado ya se ve. Si hace falta el código, imprimirlo desde dentro del script |
| Diálogo por un encadenado largo | Mezclar tuberías con `;` y varios comandos en una sola llamada | Una llamada por comando, cada una empezando por un prefijo permitido |
| Diálogo al leer el resultado de una tarea en segundo plano | Rutas temporales largas con `$TEMP`/`%TEMP%` o comodines raros | `cat`/`tail` con la ruta absoluta completa entre comillas, o leerla con Node y `fs` |
| Diálogo en un comando que solo COMPRUEBA cosas | El propio texto del comando contiene literales sensibles (`git push`, `npm install`, `supabase db`, `rm `) porque forman parte de una lista o de una expresión regular de verificación | Mover la comprobación a un script `.mjs` del scratchpad y ejecutarlo con `node ruta.mjs`: el literal deja de estar en la línea de comandos. Nunca reformular así una acción que de verdad ejecute algo sensible |

Regla práctica: **si el contenido que vas a escribir lleva saltos de línea, comentarios,
backticks o `${…}`, no lo metas en `node -e`.** Usa la edición directa del archivo (para
cambios acotados) o un script `.mjs` en el scratchpad (para transformaciones repetitivas).
Las dos vías son trabajo local rutinario y no interrumpen a nadie.

Esto no cambia ninguna frontera: `git add/commit/push`, dependencias, deploy, n8n real,
producción y todo lo que esté en `ask` o `deny` se siguen pidiendo igual, y reformular jamás
se usa para colarlos.

## En Windows hay dos cajas: usa los scripts de npm, no `npx`

Comprobado el 2026-08-13 en `E:\agen` con evidencia directa (`require.cache` del worker):

```
E:\AGEN\node_modules\playwright\lib\globals.js     <- lo carga el runner
E:\agen\node_modules\playwright\lib\globals.js     <- lo carga el archivo de prueba
```

Los atajos de `node_modules/.bin` resuelven el binario por una ruta con la letra de unidad y el
nombre de carpeta en **otra caja** (`E:\AGEN`) que la del `cwd` (`E:\agen`). La caché de módulos
de Node distingue mayúsculas, así que se cargan **dos copias** de la misma librería. Síntomas
comprobados:

- Playwright: las 172 pruebas de contrato fallan con *"Playwright Test did not expect
  test.describe() to be called here"*.
- `next build`: revienta en el prerender con `Cannot read properties of null (reading
  'useContext')` o `Expected workUnitAsyncStorage to have a store`.

No es un fallo del repositorio ni de las pruebas — en Linux (el CI) no ocurre.

Usa siempre los scripts, que invocan el binario por ruta relativa al `cwd` y cargan una sola
copia:

- solo contrato (rápida, sin navegador, sin red, sin servidor): `npm run test:contrato`
- completa: `npm run test:e2e`
- por rol: `npm run test:e2e -- --project=admin` (o `platform`, `professional`, `client`)

- build de producción: `npm run build` (ya invoca el binario por ruta relativa)

Para reproducir el job rápido del CI tal cual: `CI=1 npm run test:contrato`.

## Pruebas temporales: se mueven, no se borran

Para una prueba desechable usa el prefijo `__tmp-` (`tests/contract/__tmp-loquesea.spec.ts`).
Al terminar **no la borres**: `rm` sigue en `deny` y Node tampoco es la puerta de atrás. Muévela
al scratchpad de la sesión, que es lo que `settings.local.json` autoriza:

```
mv tests/contract/__tmp-*.spec.ts "$SCRATCHPAD/probes/"
```

Así el repositorio queda limpio (`git status` sin restos) sin tocar ninguna regla de borrado.

## Cómo esperar una suite sin interrumpir

Las suites de este proyecto tardan minutos:

Patrón recomendado:

1. **si la herramienta permite ejecución en segundo plano, úsala** y guarda el identificador
   de la tarea; **si no, espera con comandos seguros ya permitidos** (`sleep` más una lectura
   posterior, o un bucle de espera que solo consulte el resultado);
2. mientras tanto sigue con trabajo que no toque el servidor de desarrollo;
3. lee el output con `cat` o `tail` cuando esté disponible.

Nunca dejes el turno bloqueado con una espera larga en primer plano ni sondees en bucle
apretado.

## Servidor de desarrollo

Reinícialo con `npm run dev:restart`, consúltalo con `npm run dev:estado` y **deténlo sin
volver a levantarlo** con `npm run dev:detener`. Los tres usan `scripts/dev-restart.mjs`, cuyo
alcance está grabado en el código: solo detiene procesos `node.exe` que sean de Next **y** o
bien traigan la ruta de este repositorio en su línea de comando, o bien usen el binario exacto
`node_modules/next/dist/bin/next` con uno de los puertos reservados de AGEN (3000, 3010), con
exclusión explícita de MediCore. **No abras PowerShell ni `Stop-Process` por tu cuenta**: si
hace falta más alcance, amplía el script y explícalo, no el permiso.

`dev:detener` existe por una razón concreta: en Windows el servidor deja abierto
`node_modules/@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node`, y mientras lo tenga
abierto `npm ci` falla con `EPERM: operation not permitted, unlink`. Si ves ese error, para el
servidor y repite.

Ten presente que `npm run build` sobrescribe `.next` y deja inservible un `npm run dev` que
estuviera corriendo: después de un build, reinicia el dev.

## Relación con las demás reglas

`CLAUDE.md` manda sobre arquitectura, calidad, verificación y modo de trabajo; esta skill solo
decide **cómo ejecutar** lo local. En particular siguen intactas: no inventar resultados ni
verificaciones (§0), verificar antes de entregar con `lint` y `typecheck` (§9) y el orden
local → probado al 100% → commit → push (§9). Que el push ya no pida confirmación no relaja
nada de eso: sube solo lo probado y solo lo conversado. Nada de lo que hay aquí autoriza a
desplegar ni a tocar producción.
