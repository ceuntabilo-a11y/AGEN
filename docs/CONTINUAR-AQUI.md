# Continuar aquí — estado al cerrar la sesión del 2026-08-18

Documento de traspaso. Lo lee una sesión nueva **sin ningún contexto previo** para seguir sin
volver a investigar.

---

## 1. Dónde está todo

| Cosa | Estado |
|---|---|
| Rama de trabajo | `router-intenciones` |
| PRs #37 a #45 | **Mergeados y desplegados** |
| Producción (`agen.synetia.site`) | Al día con `main` |
| Workflow n8n `AGEN 01` (id `AzDW3YKqDHi9Qj8A`) | Activo, con el router de intención |
| Modelo del agente | `gpt-5.6-luna` (variable `AGEN_AGENT_MODEL` en n8n) |
| Migraciones | Ninguna pendiente |

**Los PRs #2, #30, #32 y #35 están abiertos y son ANTIGUOS**, de otras ramas anteriores a este
trabajo. No forman parte de esto; hay que decidir aparte si se cierran.

---

## 2. El fallo abierto — lo último que vio el dueño

Conversación real por WhatsApp, negocio «Estética Bella Vida». El cliente escribió:

```
21:09  Hola
21:10  Quiero agendar pa mañana en la tarde tipo 2
21:10  Perruqueria para caballero si es que hay
```

Y el agente contestó **dos veces**:

```
21:10  Hola Dorian, perfecto 😊 Busco disponibilidad para mañana en la tarde a las 14:00.
       ¿Qué servicio quieres reservar? (ej. Corte y Peinado, Coloración Completa, …)

21:11  Hola Dorian 😊 Perfecto, te busco disponibilidad para las 15:00.
       ¿Es para Corte y Peinado (caballero) y para qué día lo quieres?
```

### Cinco fallos en tres mensajes

1. **Dos respuestas a dos mensajes seguidos.** El agrupado (2,5 s) no los juntó: cada mensaje
   abrió su propia ejecución y cada una contestó. Es el mismo fallo del saludo triplicado, que se
   creía arreglado subiendo la espera de 0,6 s a 2,5 s. **No alcanza.**
2. **La hora salió distinta en cada respuesta: 14:00 y 15:00.** «tipo 2» es chileno para «a eso de
   las 2». `horaDelMensaje` (en `src/lib/agent-tiempo.ts`) NO lo reconoce: exige una pista («a
   las», «hrs», «pm», «de la tarde») y «tipo 2» no la tiene. Sin hora en `PEDIDO`, el modelo se la
   inventó — y como fueron dos ejecuciones, se la inventó dos veces distinto.
3. **Nunca llamó a `buscar_horarios`.** Dijo «busco disponibilidad» y no ofreció ni un horario.
   Prometer una búsqueda y no hacerla es justo lo que el router venía a impedir.
4. **Perdió el día.** La segunda respuesta pregunta «¿para qué día lo quieres?» cuando el cliente
   ya había dicho «mañana».
5. **No reconoció el servicio.** «Perruqueria para caballero» (con el error de tipeo) no se
   emparejó con «Corte y Peinado»; volvió a preguntar qué servicio quería.

### Lo que SÍ funcionó
- Saludó por su nombre («Hola Dorian»): el arreglo de la Tanda 1 está vivo.
- El saludo suelto se contestó por el camino rápido, sin gastar modelo.

### Hipótesis a comprobar — NINGUNA está verificada
- **El agrupado.** Mirar las ejecuciones reales de esa conversación
  (`npm run n8n -- ejecuciones AzDW3YKqDHi9Qj8A 20` y `npm run n8n -- dijo <id>`) para ver si
  entraron como dos grupos o si el reclamo falló. Si llegaron separadas por más de 2,5 s, el
  arreglo no es subir el número: es esperar a que el cliente deje de escribir.
- **«tipo 2».** Falta en la tabla de `horaDelMensaje`. Con ella, seguramente «como a las», «cerca
  de las», «a eso de».
- **Por qué no buscó.** Hay que leer el `systemMessage` y el `userMessage` que mandó
  `/api/agent/turn` en esa ejecución. Puede ser que la rama fuera BUSCAR pero el modelo
  prefiriera preguntar, o que el servicio no se identificara y por eso no llamara la herramienta.

---

## 3. Qué se hizo en esta sesión

Router de intención completo: **el modelo entiende y redacta; el código ejecuta.**

- `POST /api/agent/turn` decide la rama con reglas + estado real de la base.
- `POST /api/agent/act` es el ÚNICO sitio donde ocurren reservas, cancelaciones, movimientos y
  confirmaciones. Sin `confirmado: true` no ejecuta nada, y el texto de confirmación lo escribe la
  app con los datos guardados.
- Solo queda `buscar_horarios` como herramienta del modelo.
- Encuesta: se manda al cerrar la cita como atendida, entiende notas 0–10 y las guarda; con 9 o 10
  pide reseña en Google con el enlace de la configuración del negocio.
- Interruptores del Agente IA: «habilitado», «tono» y «transferir a una persona» ya hacen algo.
- Finanzas: buscador, fichas abribles, presupuesto como documento y envío por WhatsApp/correo.

Informe para un revisor independiente: `docs/ROUTER-INTENCIONES.md`.
Respaldo del workflow anterior: `n8n-workflows/respaldo/01-agen-agent.ANTES-DEL-ROUTER.json`.
Volver atrás: `node scripts/restaurar-workflow.mjs <ese archivo> AzDW3YKqDHi9Qj8A`.

---

## 4. Plan aprobado por el dueño

Aprobado el 2026-08-18. **Tandas 1 y 2 hechas.** Las respuestas del dueño a las dudas ya están
incorporadas.

| # | Tanda | Estado |
|---|---|---|
| 1 | Interruptores del Agente IA | ✅ hecha (PR #44) |
| 2 | Finanzas: buscar, abrir, documento, enviar | ✅ hecha (PR #45) |
| 3 | **Marketing con filtros de CRM** | ⬅️ **la siguiente** |
| 4 | Configuración coherente | pendiente |
| 5 | Integraciones probadas una a una | pendiente |
| 6 | Importación inteligente multiformato | pendiente (pide instalar librería de Excel) |
| 7 | Foto del profesional | pendiente (**necesita SQL**) |
| 8 | Invitaciones | pendiente |
| 9 | Centro de ayuda | pendiente |

### Detalle de lo que falta

**Tanda 3 — Marketing/CRM.** Buscador por nombre en la selección de destinatarios. Filtros: última
visita, asistieron en los últimos 7/15/30 días, tiempo desde la última visita, cuántas veces ha
venido, y «vino 2 o 3 veces en los últimos 30 días». Enviar la campaña por correo, WhatsApp **o
ambos a la vez** (hoy es uno u otro).

**Tanda 4 — Configuración.** Zona horaria y moneda: **solo las cambia el dueño de la plataforma**
(decisión del dueño), así que hay que bloquearlas en la configuración del negocio y sincronizar.
El enlace de reseñas debe vivir en **Integraciones** y reflejarse igual en Configuración (hoy está
solo en Configuración). El logo debe aplicarse en el portal del cliente y en los correos (hoy solo
en el presupuesto). Comprobar que encuestas y recordatorios respetan los tiempos configurados.

**Tanda 5 — Integraciones.** Probar cada una de punta a punta y decir cuál no funciona.

**Tanda 6 — Importar clientes.** Hoy solo acepta CSV. Debe aceptar Excel, CSV, Word, TXT y
contactos de WhatsApp, varios archivos a la vez, con IA que ordene y corrija, y previsualización
con datos detectados, correspondencia de columnas, errores y resultado final. **Requiere instalar
una librería para leer Excel: hay que pedir permiso antes.** Lo mismo aplica al apartado «Planes y
datos» (el dueño confirmó que es la misma importación).

**Tanda 7 — Foto del profesional.** El dueño eligió la **opción (b)**: NADA de generar fondos con
IA. Recortar el fondo, mejorar nitidez y poner un fondo del color de la marca, con comparación
antes/después antes de guardar. **Necesita una migración**: `professionals` no tiene columna de
foto. Y añadir `professional` a los buckets de `/api/admin/upload`.

**Tanda 8 — Invitaciones.** El dueño aclaró: es **invitar a un dueño de negocio** para que pida que
lo contacten y mostrarle el producto en una **entrevista de descubrimiento**. NO es invitar a un
miembro del equipo. Hoy la pantalla «Invitar» es de referidos y hay que revisarla con ese objetivo.

**Tanda 9 — Centro de ayuda.** Base de conocimiento **escrita a mano** desde el código real, con
buscador que entienda preguntas parecidas. **Sin coste de IA por pregunta** (confirmado).

---

## 5. Cómo se trabaja aquí (lo que más duele si no se sabe)

1. **Silencio total mientras se trabaja.** Nada de avisos de progreso. Solo un bloqueo humano real
   o el informe final, con el formato de `CLAUDE.md` §9.
2. **El informe final en lenguaje sencillo**, enumerado, sin tecnicismos, diciendo cómo quedó en la
   práctica, con los pasos del dueño detallados y en orden (por ejemplo: «implementar solo en
   agen-web», «no hay que correr SQL»).
3. **Nunca entregar algo roto.** Si algo puede dañar lo que funciona, copia de seguridad antes.
4. **Cada PR se mergea con squash**, así que la rama diverge. Antes del siguiente PR:
   `npm run git -- integrar-main` y después `npm run git -- quedarme-con-lo-mio`.
5. **`gh pr merge` está bloqueado**: el dueño mergea a mano, y el deploy en EasyPanel (servicio
   **agen-web**) también lo hace él.
6. **El CI se cuelga a veces** (una vez 31 min y quedó cancelado). Se relanza con
   `gh run rerun <id>`.
7. **En esta máquina Bash necesita PATH explícito:**
   `export PATH="$PATH:/c/Program Files/nodejs:/c/Program Files/Git/cmd:/c/Program Files/Git/usr/bin:/c/Windows/System32:/c/Program Files/GitHub CLI"`
8. Hay un `node.exe` viejo ocupando el puerto 3010 con un build viejo que `npm run app -- detener`
   no reconoce. Para probar en local, usar otro puerto.
9. **Probar contra producción encuentra lo que las pruebas no.** Los tres fallos más caros de esta
   sesión salieron así, no de la batería.
