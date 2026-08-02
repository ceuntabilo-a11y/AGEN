# Mejoras de MediCore adaptadas a Agen

Esta actualización conserva el dominio de Agen: negocios de servicios, profesionales, especialidades y agendas independientes. No incorpora expedientes médicos, recetas ni módulos clínicos.

## Incorporado

- Agenda día/semana/mes con navegación real y tratamiento visual de reservas pasadas.
- Zona horaria del negocio en consultas, horarios y presentación.
- Cambio de estado, reagendamiento y cancelación desde la agenda administrativa.
- Restricciones del portal del cliente aplicadas en el servidor, incluso cuando la API usa service role.
- Aviso global si Supabase deja de responder.
- Recordatorios sin duplicados inmediatos cuando la cita está a menos de 24 o 2 horas.
- Reenvío correcto de avisos después de varios reagendamientos.
- Configuración de Google Maps para que el agente comparta una ubicación guardada y no inventada.
- Marketing con edición de la misma campaña, confirmación previa, resultados por destinatario y baja de promociones.
- Normalización de teléfonos para que el agente reconozca al mismo cliente aunque el número venga con espacios o símbolos.
- Herramientas n8n para registrar clientes y persistir memoria.
- Recuperación de contraseña con redirección al dominio actual.

## Puesta en servicio

Ejecutar la migración nueva en Supabase, desplegar la aplicación y actualizar los workflows indicados. Los gateways de WhatsApp/email siguen siendo configuraciones externas y deben usar proveedores oficiales antes de activar envíos reales.
