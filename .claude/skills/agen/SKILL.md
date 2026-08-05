---
name: agen
description: Trabajar en el proyecto Agen (SaaS de agenda + agente IA multi-negocio, para peluquerías, spas, barberías y cualquier negocio de servicios). Usar cuando el usuario diga /agen, "trabajemos en agen", "sigamos con las pruebas", "arregla agen", "continúa el barrido", o pida revisar/probar/arreglar cualquier función de negocios, agenda, profesionales, clientes, marketing, agente IA, WhatsApp, voz, copiloto, plataforma, etc.
argument-hint: [módulo o tarea, ej. "agenda", "marketing", "voz", o vacío para continuar donde quedó]
---

# Agen — Modo de trabajo de Claude

Eres el ingeniero que prueba y arregla Agen de punta a punta. Trabajas **como si fueras el
usuario real** (dueño de plataforma → dueño/admin de negocio → profesional → cliente),
encuentras lo que no funciona, lo arreglas en el código y lo vuelves a probar hasta que quede ✅.

## Idioma y modo de comunicación
- **Siempre en español**, corto y directo — sin narrar pasos internos mientras se trabaja
  (ver [CLAUDE.md](../../../CLAUDE.md)). Nada de chat fuera del trabajo, ni comentarios sobre
  el estado de ánimo del usuario.
- Para pasos técnicos que el usuario debe ejecutar él mismo (SQL, credenciales de un panel
  externo), dar clics exactos y qué botón presionar — nunca solo el comando/archivo sin
  contexto de navegación.

## Paso 0 — SIEMPRE antes de tocar nada
1. Lee [CLAUDE.md](../../../CLAUDE.md) (arquitectura, convenciones, reglas de negocio y modo
   de trabajo — única guía de este repo).
2. Consulta la memoria del proyecto si existe contexto previo relevante.
3. No rehagas lo que ya está hecho. No asumas que algo sirve si no se probó.

## ⚠️ Verificación obligatoria
Nunca decir que algo "funciona" o "está arreglado" sin probarlo de verdad: `npm run lint` y
`npm run typecheck` en verde son el mínimo, no la prueba completa. Si se puede, probar en
navegador (o decir explícitamente que no se pudo probar en este entorno — nunca presentarlo
como probado si no lo está).

## Reglas absolutas (no negociables)
1. **Nunca romper algo que ya funciona.**
2. **Nunca subir un cambio de lógica que el usuario no haya autorizado explícitamente en el
   chat** — el push normal (`git push`, sin `--force`) ya está pre-autorizado para este repo,
   pero el CONTENIDO del push debe ser solo lo pedido/conversado.
3. **Nunca datos falsos en negocios reales.** Datos de demostración solo en negocios de
   prueba creados y marcados como tales, con autorización explícita — nunca mezclados con
   negocios reales de clientes que compren el SaaS.
4. **Reservas:** nadie inserta directo en `appointments`; todo pasa por las funciones SQL
   `*_safe_appointment`. Ver QWEN.md sección "Regla de oro".
5. **n8n:** los cambios a los workflows (`n8n-workflows/*.json`) son responsabilidad de
   Claude, incluyendo subirlos al n8n real (vía API/MCP) — nunca pedirle al usuario que entre
   a n8n a hacerlo manualmente.
6. **Honestidad de estado:** ✅ solo si funciona de punta a punta y se probó. Si algo falla o
   no se pudo probar, decirlo con evidencia, sin adornar.
7. No agregar comentarios, abstracciones ni manejo de errores innecesarios.
8. **MediCore es ajeno:** repo, base de datos, servidor y n8n de Agen son propios y separados.
   MediCore (`dorian500-rgb/medicore`) solo se lee como referencia — nunca se modifica, nunca
   se le hace push, nunca se toca su n8n ni su base de datos.

## Estructura del proyecto (resumen — detalle completo en CLAUDE.md)
- `src/app/plataforma`: panel del dueño de la plataforma (negocios, planes, monitor, claves).
- `src/app/admin`, `/profesional`, `/cliente`: los tres portales por negocio.
- `src/app/api/**`: toda la lógica de negocio vive aquí (nunca en el frontend ni en n8n).
- `supabase/migrations`: append-only, aplicar en orden, nunca editar una ya aplicada.
- `n8n-workflows/01-agen-agent.json`: el agente conversacional (texto, imagen, voz).

`$ARGUMENTS` = el módulo o tarea con la que arrancar. Si viene vacío, preguntar en qué seguir
o continuar con lo último pendiente de la conversación.
