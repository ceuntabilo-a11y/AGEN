# Router de intención — informe para un segundo revisor

Este documento se escribió para que otra sesión, **sin ningún contexto previo**, pueda auditar
el cambio buscando específicamente una cosa:

> ¿Queda algún punto donde el modelo conversacional decide una acción crítica en vez del
> código fijo?

Fecha: 2026-08-17 · Rama: `router-intenciones` · Base: `main`

---

## 1. El problema que se venía a arreglar

Un único nodo de agente en n8n tenía **nueve herramientas** conectadas y decidía por su cuenta
cuándo llamarlas: `buscar_horarios`, `crear_reserva`, `registrar_cliente`, `guardar_memoria`,
`mis_reservas`, `confirmar_reserva`, `liberar_reserva`, `mover_reserva`, `avisar_al_equipo`.

Síntoma real: el chat daba por hecha una reserva que nunca llegó a la base y, más tarde, el
sistema contestaba «no hay reserva activa».

La única defensa era `revisarRespuesta()` en `src/lib/agent-reply.ts`, que bloqueaba el texto si
afirmaba una reserva sin evidencia. Era una **lista negra de frases**: se escapaba cualquier
redacción equivalente que no estuviera en la lista (por ejemplo «Perfecto, te espero el martes a
las 15:00»).

---

## 2. Qué se hizo, en una frase

El modelo pasó de **decidir y ejecutar** a **entender y redactar**. Las acciones las decide el
estado de la base de datos y las ejecuta un endpoint fijo.

---

## 3. Los tres puntos de control (y dónde mirarlos)

### 3.1 `src/lib/agent-router.ts` — quién decide la rama

Dos capas, en este orden:

1. `clasificarPorReglas(mensaje, estado)` propone una intención. Si la señal es ambigua devuelve
   `confianza: 'BAJA'` y `POST /api/agent/turn` consulta un clasificador (una llamada a
   `gpt-4o-mini` de ~6 tokens de salida, **sin ninguna herramienta conectada**). Si no hay clave
   o falla, manda la regla.
2. `aplicarGuardas(intencion, estado)` corrige contra los hechos. Esta capa **siempre** manda:
   - `CANCELAR` / `MOVER` / `CONFIRMAR` con `reservas.length === 0` → se degrada a `AGENDAR` y
     se devuelve un texto directo. No se llama a ningún modelo.
   - `ELEGIR` sin apartados vivos → `AGENDAR`.

`rutaDe(intencion)` mapea a cuatro ramas: `DIRECTA`, `INFO`, `BUSCAR`, `DECIDIR`.

**Punto a auditar:** que ninguna intención pueda llegar a `DECIDIR` con el estado equivocado.

### 3.2 `src/app/api/agent/turn/route.ts` — qué ve el modelo

Devuelve `ruta`, `systemMessage` (las instrucciones de esa rama, desde código), `userMessage`
(el contexto) y `texto` (solo en `DIRECTA`).

Las instrucciones de `INFO` y `BUSCAR` dicen explícitamente que el modelo **no puede reservar,
mover, cancelar ni confirmar**, y que tiene prohibido afirmarlo.

### 3.3 `src/app/api/agent/act/route.ts` — quién ejecuta

Es el **único** sitio del sistema donde el agente muta algo. Reglas, todas verificables leyendo
el archivo:

1. `decision.confirmado !== true` → no ejecuta nada y devuelve una pregunta.
2. `leerDecision()` acepta el JSON aunque venga envuelto en texto o en vallas de código; si no
   se puede parsear, no ejecuta nada (`motivo: 'DECISION_ILEGIBLE'`).
3. `intencion` fuera de la lista blanca → `NINGUNA`.
4. `appointmentId` se busca con `findClientAppointment(businessId, clientId, appointmentId)`:
   si no es de ese cliente y ese negocio, no existe. **Nunca** se resuelve «la más próxima».
5. `holdId` tiene que existir, ser del negocio y no haber vencido.
6. El texto que recibe el cliente lo construye `src/lib/agent-textos.ts` con los campos que
   devolvió la base. El modelo no participa.

---

## 4. Dónde SIGUE participando el modelo (y por qué es seguro)

| Rama | Qué hace el modelo | Herramientas | Puede ejecutar |
|---|---|---|---|
| `DIRECTA` | nada | — | no |
| `INFO` | redacta con el catálogo ya cargado | ninguna | no |
| `BUSCAR` | llama `buscar_horarios` y ofrece | `buscar_horarios` | no (solo aparta cupos) |
| `DECIDIR` | devuelve un JSON | ninguna | no |

`buscar_horarios` es la única herramienta que queda. Escribe en `appointment_holds` (apartados
de 10 minutos) pero **no** en `appointments`, y los apartados vencen solos.

---

## 5. Lo que el revisor debería intentar romper

1. **Hacer que `/api/agent/act` ejecute con `confirmado: false`.** Cubierto en
   `tests/contract/router-conversaciones.spec.ts`.
2. **Cancelar la hora de otro cliente** mandando su `appointmentId`. Cubierto.
3. **Reservar sin apartado**, o con uno vencido. Cubierto.
4. **Dos clientes con el mismo `holdId`.** Cubierto: el segundo recibe `CUPO_OCUPADO` y solo se
   crea una reserva.
5. **Un `appointmentId` inventado con dos reservas vigentes** — no debe cancelar «la más
   próxima». Cubierto.
6. **Un turno que llega con `RESERVAS` vacío pidiendo cancelar** — no debe llamar a ningún
   modelo. Cubierto.
7. **Una afirmación de reserva desde la rama `INFO` o `BUSCAR`** — la debe bloquear
   `revisarRespuesta` por `ramaSinAcciones`, sin mirar evidencia.
8. **Un despliegue a medias**: el workflow apuntando a rutas que no existen. `npm run n8n --
   subir` se niega (sonda GET → 404).

---

## 6. Lo que se movió de sitio (para no buscarlo donde ya no está)

| Antes | Ahora |
|---|---|
| Prompt de ~14.500 caracteres en el nodo `Agente Agen` | `INSTRUCCIONES` por rama en `src/lib/agent-router.ts` |
| Plantilla del contexto en `parameters.text` del nodo | `armarContexto()` en `src/lib/agent-router.ts` |
| Herramientas `crear_reserva`, `liberar_reserva`, `mover_reserva`, `confirmar_reserva`, `registrar_cliente` | intenciones ejecutadas por `/api/agent/act` |
| `avisar_al_equipo` | intención `ESCALAR` → `src/lib/agent-escalation.ts` |
| `mis_reservas` | `RESERVAS`, que ya viaja en el contexto de cada turno |
| Lógica de reserva dentro de `/api/agent/book` | `src/lib/agent-booking.ts` (las dos rutas la comparten) |
| `CONFIRM_REQUEST` + `DAY_OF_REMINDER` a horas fijas | `REMINDER` × N, desde `businesses.settings.reminders` |

---

## 7. Defectos de la auditoría previa: dónde se arreglaron

| # | Defecto | Arreglo |
|---|---|---|
| D1 | `Cargar contexto` seguía a ciegas si fallaba | nodo `¿Hay contexto?`; sin `ruta` el turno no llega a ningún modelo |
| D2 | guarda anti-alucinación por frases | `ramaSinAcciones` en `src/lib/agent-reply.ts` + textos de acción escritos por código |
| D3 | `Ya respondió otro` no contestaba al webhook | ahora es un `respondToWebhook` |
| D4 | `mover_reserva` sin reintento | la herramienta ya no existe; la acción la ejecuta un nodo HTTP con reintento |
| D5 | referencia a `$('Cargar catálogo')`, nodo inexistente | eliminada del código de `buscar_horarios` |
| D6 | apartado documentado como 15 min, real 10 | README y prompts dicen 10 |
| D7 | README afirmaba que multimedia y voz estaban conectadas | reescrito; y ahora sí lo están |
| D8 | `mis_reservas` duplicaba `RESERVAS` | herramienta eliminada |
| D9 | `active: false` en el JSON | el workflow se sube y se activa por API, con sonda previa |

---

## 8. Lo que NO se pudo verificar

- **El workflow nuevo no se ha ejecutado nunca en n8n.** No se puede hasta que la app esté
  desplegada, porque llama a `/api/agent/turn` y `/api/agent/act`, que hoy devuelven 404 en
  producción. `npm run n8n -- subir` se niega a subirlo por eso.
- En concreto, no está comprobado en ejecución real que el nodo `AI Agent` de esta instancia de
  n8n funcione **sin ninguna herramienta conectada** (ramas `Redactor` y `Decisor`). Los tres
  nodos llevan `onError: continueRegularOutput` como red, pero la conducta hay que verla.
- El nodo `Bajar multimedia` (Evolution `/chat/getBase64FromMediaMessage`) no se ha probado
  contra un mensaje real con foto o nota de voz.
- La migración SQL no se ha aplicado a ninguna base: está escrita y es idempotente, pero no
  ejecutada.
- El envío de nota de voz por Evolution (`/message/sendWhatsAppAudio`) no se ha probado con un
  envío real.
