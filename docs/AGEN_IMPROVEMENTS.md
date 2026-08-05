# Mejoras del roadmap Agen

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
- Apartados transaccionales de 15 minutos para los horarios ofrecidos por el agente.
- Agenda por carril profesional con buscador, movimiento seguro entre profesionales y ajuste validado de duración.
- Campana de avisos del equipo, preferencias por profesional y resumen diario.
- Seguimiento automático de ausencias, presupuestos sin respuesta y clientes inactivos, además de lista de espera.
- Calendario privado `.ics` para cada profesional y descarga de reservas al calendario del cliente.
- Portal del cliente con confirmación, reagendamiento y cancelación aplicados en el servidor.
- Instalación PWA en móvil, tableta y computador, sin almacenar datos privados fuera de línea.
- Caducidad de sesión, bloqueo de intentos repetidos de inicio de sesión, auditoría de reservas y cabeceras de seguridad.
- Menú de cuenta real, perfil profesional y confirmación antes de cerrar sesión.
- Dependencias de producción actualizadas y auditoría npm sin vulnerabilidades conocidas.
- Copiloto interno de solo lectura con datos reales y accesos directos a la pantalla correcta.
- Reconocimiento del teléfono del profesional, administración y recepción en el agente: muestra el contexto autorizado del día y bloquea por código cualquier acción de reserva desde el modo equipo.

## Adaptación de alcance

Se copiaron todas las mejoras generales del roadmap final de MediCore que aplican a un SaaS de agenda. No se incorporaron odontogramas, recetas, DICOM, consentimientos médicos, tratamientos clínicos ni el panel de clínicas de MediCore porque no pertenecen al producto Agen.

## Puesta en servicio

Ejecutar `supabase/migrations/20260803000001_agen_latest_updates.sql` después de las migraciones anteriores, desplegar la aplicación y mantener los workflows inactivos hasta configurar sus credenciales y gateways oficiales.
