# Agen

**Agenda + Agente inteligente** para negocios de servicios.

## Desarrollo local

1. Copiar `.env.example` a `.env.local` y configurar Supabase.
2. Instalar dependencias con `npm install`.
3. Iniciar con `npm run dev`.

## EasyPanel sin Docker

Crear una aplicación desde el repositorio GitHub y configurar:

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Puerto: `3010`
- Node.js: `20.9` o superior (recomendado: `22`)
- Health check: `/api/health`

Las credenciales se cargan como variables de entorno en EasyPanel. La base de datos se crea con las migraciones de `supabase/migrations` y los workflows se importan desde `n8n-workflows`.

## Regla de reservas

El agente nunca inserta directamente en `appointments`. Primero resuelve especialidad y servicio; después consulta disponibilidad y finalmente llama a la función transaccional de reserva. PostgreSQL es la autoridad final ante conflictos.

## Mejoras adaptadas de MediCore

- Agenda administrativa navegable por día, semana y mes, con colores por profesional y gestión de estados.
- Fechas, panel e intervalos calculados en la zona horaria del negocio, no en la del servidor.
- Reagendamiento y cancelación seguros, con revalidación transaccional del horario.
- Monitor visible de conexión con Supabase.
- Campañas editables con confirmación, destinatarios y resultado real por entrega.
- Baja pública de promociones por email, separada de avisos necesarios sobre reservas.
- Agente n8n con registro seguro de clientes nuevos, memoria persistente, ubicación real y guardia contra confirmaciones fantasma.
- Apartados de 15 minutos, avisos internos, seguimiento, lista de espera, calendario externo, PWA y seguridad de sesión.
- Modo equipo de solo lectura protegido también por las API: ningún mensaje del personal puede crear clientes, ofrecer cupos ni reservar aunque el modelo intente usar una herramienta.

Aplicar, en orden, `supabase/migrations/20260801000001_medicore_improvements.sql` y `supabase/migrations/20260803000001_medicore_latest_updates.sql` antes de desplegar esta versión. Después se deben actualizar/importar los workflows `01-agen-agent.json` y `04-followups-daily.json` en n8n.
