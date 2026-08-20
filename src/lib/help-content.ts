import type { ArticuloAyuda } from '@/lib/help-search'

/**
 * Base de conocimiento del Centro de ayuda (Tanda 9), escrita a mano a partir del código real
 * — cada respuesta describe lo que el botón/pantalla realmente hace hoy, no una versión
 * genérica. Si una pantalla cambia, esta lista hay que actualizarla con ella.
 */
export const ARTICULOS_AYUDA: ArticuloAyuda[] = [
  // ── Agenda ──────────────────────────────────────────────────────────────
  {
    id: 'agenda-nueva-reserva',
    categoria: 'Agenda',
    pregunta: '¿Cómo hago una reserva a mano?',
    alias: ['agendar una hora', 'reservar para un cliente', 'crear una cita', 'anotar una hora'],
    respuesta: 'Agenda → botón "Nueva reserva". Elige cliente, servicio y fecha, pulsa "Buscar disponibilidad" y elige una de las horas que aparecen: son las que de verdad están libres, revalidadas al guardar.',
  },
  {
    id: 'agenda-sin-horas',
    categoria: 'Agenda',
    pregunta: '¿Por qué no aparecen horas disponibles?',
    alias: ['no hay horarios', 'la agenda está vacía', 'no deja reservar', 'no encuentra cupos'],
    respuesta: 'Casi siempre es el horario: Equipo → botón "Horario" en la tarjeta del profesional. Si no tiene días cargados, no se generan cupos. Revisa también que el servicio esté activo y asignado a ese profesional, y que el negocio no esté cerrado ese día (Configuración → Horario de atención).',
  },
  {
    id: 'agenda-mover-cita',
    categoria: 'Agenda',
    pregunta: '¿Cómo cambio la hora de una reserva ya hecha?',
    alias: ['reagendar', 'mover una cita', 'cambiar el horario de un cliente', 'atrasar una hora'],
    respuesta: 'Abre la reserva en la Agenda (o arrástrala a otro horario) y confirma el cambio: siempre pide un motivo antes de aplicarlo, y ese motivo —junto con la hora nueva— se le avisa al cliente automáticamente.',
  },
  {
    id: 'agenda-no-asistio',
    categoria: 'Agenda',
    pregunta: '¿Qué pasa si un cliente no llega?',
    alias: ['cliente no se presentó', 'no show', 'faltó a la hora'],
    respuesta: 'En la agenda del profesional, botón "No asistió". Queda registrado en su ficha y aparece en Seguimiento para que lo contactes.',
  },
  {
    id: 'agenda-dia-cerrado',
    categoria: 'Agenda',
    pregunta: '¿Por qué la agenda muestra un día como cerrado?',
    alias: ['día bloqueado en la agenda', 'no puedo reservar un domingo'],
    respuesta: 'El horario del negocio (Configuración → Horario de atención) manda sobre el de cada profesional: si el negocio no atiende ese día, la agenda lo marca "Cerrado" y bloquea "Nueva reserva" ahí, aunque algún profesional tenga cargado ese día en el suyo.',
  },

  // ── Equipo ──────────────────────────────────────────────────────────────
  {
    id: 'equipo-agregar-profesional',
    categoria: 'Equipo',
    pregunta: '¿Cómo agrego un profesional nuevo?',
    alias: ['sumar un empleado', 'crear un estilista', 'agregar personal'],
    respuesta: 'Equipo → botón "Agregar profesional". Pide correo y nombre; se le manda una invitación para que cree su contraseña. Nace con horario lunes a viernes 09:00–18:00, editable después con el botón "Horario" de su tarjeta.',
  },
  {
    id: 'equipo-foto-profesional',
    categoria: 'Equipo',
    pregunta: '¿Cómo le pongo una foto a un profesional?',
    alias: ['subir foto de un empleado', 'cambiar la imagen de un estilista', 'foto de perfil del equipo'],
    respuesta: 'Equipo → botón "Foto" en su tarjeta. Subes la foto, eliges el fondo (el color de tu marca, o uno generado con IA describiéndolo tú) y aprietas "Ajustar foto": recorta el fondo original y mejora la nitidez. Ves un Antes/Después antes de guardar.',
  },
  {
    id: 'equipo-desactivar-profesional',
    categoria: 'Equipo',
    pregunta: '¿Cómo doy de baja a un profesional que ya no trabaja conmigo?',
    alias: ['eliminar un empleado', 'quitar un estilista del equipo', 'profesional que renunció'],
    respuesta: 'Equipo → "Editar" en su tarjeta → "Desactivar profesional". No se borra su historial: deja de aparecer en los cupos, en el portal del cliente y en el agente, pero sus reservas pasadas quedan intactas.',
  },
  {
    id: 'equipo-especialidades',
    categoria: 'Equipo',
    pregunta: '¿Qué son las especialidades y para qué sirven?',
    alias: ['crear una especialidad', 'categorías de servicios', 'rubros del negocio'],
    respuesta: 'Agrupan servicios afines (ej. "Peluquería", "Manos y pies"). Se crean al final de Equipo, y cada servicio nuevo necesita una asignada — el agente nunca ofrece un servicio de una especialidad distinta a la que el cliente pidió.',
  },

  // ── Servicios ───────────────────────────────────────────────────────────
  {
    id: 'servicios-nuevo',
    categoria: 'Servicios',
    pregunta: '¿Cómo agrego un servicio nuevo?',
    alias: ['crear un servicio', 'agregar un tratamiento', 'sumar algo al catálogo'],
    respuesta: 'Servicios → "Nuevo servicio". Nombre, especialidad, duración y precio son obligatorios; también puedes cargar costo de materiales, anticipo y qué profesionales lo pueden hacer. Si el negocio todavía no tiene especialidades, créala primero en Equipo.',
  },
  {
    id: 'servicios-desactivar',
    categoria: 'Servicios',
    pregunta: '¿Cómo elimino un servicio?',
    alias: ['borrar un servicio', 'quitar un tratamiento del catálogo'],
    respuesta: 'No se borra: se desactiva. Servicios → "Editar" → "Desactivar servicio". Deja de ofrecerse en la agenda, el portal y el agente, pero las reservas pasadas que lo usaron no se pierden. "Reactivar servicio" lo vuelve a mostrar.',
  },
  {
    id: 'servicios-margen',
    categoria: 'Servicios',
    pregunta: '¿Qué es el margen que aparece en Servicios?',
    alias: ['ganancia por servicio', 'rentabilidad de un tratamiento'],
    respuesta: 'Se calcula solo, con precio y costo de materiales que cargaste: (precio − costo) ÷ precio. No incluye comisiones ni otros gastos.',
  },

  // ── Clientes ────────────────────────────────────────────────────────────
  {
    id: 'clientes-nuevo',
    categoria: 'Clientes',
    pregunta: '¿Cómo agrego un cliente nuevo a mano?',
    alias: ['crear un cliente', 'registrar un cliente'],
    respuesta: 'Clientes → "Nuevo cliente". Solo el nombre es obligatorio; el resto (teléfono, correo, nacimiento, notas) es opcional. El check de comunicaciones comerciales solo se marca si el cliente de verdad autorizó recibir promociones.',
  },
  {
    id: 'clientes-importar',
    categoria: 'Clientes',
    pregunta: '¿Puedo subir mi lista de clientes de otro sistema?',
    alias: ['importar clientes desde excel', 'subir un csv de clientes', 'migrar clientes', 'importar contactos de whatsapp'],
    respuesta: 'Clientes → "Importar" (o Configuración → Plan y datos → "Subir Excel, CSV, Word, texto o contactos"). Acepta varios archivos a la vez —CSV, Excel, Word, texto y contactos exportados del celular—; en Word y texto la IA del negocio busca los datos sola. Siempre hay una vista previa antes de guardar, y nunca pisa un cliente que ya existe.',
  },
  {
    id: 'clientes-eliminar',
    categoria: 'Clientes',
    pregunta: '¿Por qué no puedo eliminar un cliente?',
    alias: ['borrar un cliente no funciona', 'no deja eliminar la ficha'],
    respuesta: 'Solo se puede eliminar un cliente que no tenga reservas ni pagos registrados — si los tiene, borrarlo haría perder ese historial, así que el sistema lo bloquea. Para "sacarlo de circulación" sin perder el historial, quítale el permiso de marketing en su ficha.',
  },
  {
    id: 'clientes-invitar-portal',
    categoria: 'Clientes',
    pregunta: '¿Cómo invito a un cliente a reservar solo, sin escribirle yo?',
    alias: ['portal del cliente', 'que el cliente reserve solo', 'enlace de reservas para clientes'],
    respuesta: 'Desde la ficha del cliente, botón "Invitar": abre WhatsApp con un mensaje que ya trae su enlace de reserva. También puedes usar el enlace o el código QR generales en Invitar → "Invita a tus clientes", para pegar en tu estado o imprimir en el mesón.',
  },
  {
    id: 'clientes-memoria-agente',
    categoria: 'Clientes',
    pregunta: '¿Qué es "lo que sabe el agente" en la ficha del cliente?',
    alias: ['memoria del agente', 'resumen de conversaciones del cliente'],
    respuesta: 'Es el resumen que el agente arma solo a partir de sus conversaciones con ese cliente por WhatsApp: preferencias, cosas mencionadas, etc. Si nunca ha hablado con el agente, dice que todavía no hay nada.',
  },

  // ── Conversaciones ──────────────────────────────────────────────────────
  {
    id: 'conversaciones-atender-yo',
    categoria: 'Conversaciones',
    pregunta: '¿Cómo tomo una conversación para responder yo en vez del agente?',
    alias: ['hablar yo con el cliente', 'que el agente deje de responder', 'atender personalmente por whatsapp'],
    respuesta: 'Conversaciones → elige la conversación → "Atender yo". El agente deja de contestarle a ese cliente hasta que ap리etes "Devolver al agente". Mientras tanto, el modo equipo del agente sigue siendo de solo lectura: nunca reserva, mueve ni cancela nada por su cuenta.',
  },
  {
    id: 'conversaciones-estados',
    categoria: 'Conversaciones',
    pregunta: '¿Qué significan los estados de una conversación (Con el agente, Atiende el equipo, Cerrada)?',
    alias: ['colores de las conversaciones', 'qué significa el punto verde o ámbar'],
    respuesta: '"Con el agente" (verde): el agente responde solo. "Atiende el equipo" (ámbar): alguien tomó la conversación con "Atender yo". "Cerrada" (gris): se marcó como resuelta con el botón "Cerrar".',
  },

  // ── Seguimiento ─────────────────────────────────────────────────────────
  {
    id: 'seguimiento-que-es',
    categoria: 'Seguimiento',
    pregunta: '¿Qué es la pantalla de Seguimiento?',
    alias: ['lista de espera', 'tareas pendientes', 'a quién tengo que llamar'],
    respuesta: 'Junta dos cosas: "Qué hacer hoy" (ausencias, presupuestos pendientes y tareas que anotaste a mano) y "Esperando un cupo" (clientes que quieren un horario que hoy no hay). Un check marca la tarea lista; "Contactado" saca a alguien de la lista de espera.',
  },
  {
    id: 'seguimiento-tarea-manual',
    categoria: 'Seguimiento',
    pregunta: '¿Cómo anoto que tengo que llamar a un cliente?',
    alias: ['crear una tarea', 'recordatorio manual', 'nota para contactar a alguien'],
    respuesta: 'Seguimiento → botón "Tarea". Elige el cliente, escribe qué hay que hacer y guarda — aparece en "Qué hacer hoy" hasta que la marques completa.',
  },
  {
    id: 'seguimiento-waitlist',
    categoria: 'Seguimiento',
    pregunta: '¿Cómo anoto a un cliente en lista de espera?',
    alias: ['cliente quiere un horario que no hay', 'avisar cuando se libere una hora'],
    respuesta: 'Seguimiento → botón "Lista de espera". Elige cliente, servicio y, si quiere, el profesional preferido. Si se cancela una hora que le sirve, el sistema se lo ofrece automáticamente por WhatsApp (hasta 5 personas por cupo liberado).',
  },

  // ── Finanzas ────────────────────────────────────────────────────────────
  {
    id: 'finanzas-cobrar',
    categoria: 'Finanzas',
    pregunta: '¿Cómo cobro algo?',
    alias: ['registrar un pago', 'anotar un cobro', 'marcar como pagado'],
    respuesta: 'Finanzas → "Registrar cobro". Si todavía no te pagaron, guárdalo como "Por cobrar" y márcalo cobrado cuando llegue la plata.',
  },
  {
    id: 'finanzas-presupuesto',
    categoria: 'Finanzas',
    pregunta: '¿Cómo mando un presupuesto a un cliente?',
    alias: ['cotización', 'enviar un presupuesto por whatsapp', 'presupuesto en pdf'],
    respuesta: 'Finanzas → busca o crea el presupuesto → botón para enviarlo. Se genera como documento con tu logo (si subiste uno en Configuración) y se puede mandar por WhatsApp o correo directamente desde ahí.',
  },
  {
    id: 'finanzas-gasto',
    categoria: 'Finanzas',
    pregunta: '¿Cómo registro un gasto del negocio?',
    alias: ['anotar un gasto', 'cargar una compra'],
    respuesta: 'Finanzas tiene una sección de gastos separada de los cobros: se anota el monto, la categoría y la fecha, y entra en los números generales del negocio.',
  },

  // ── Marketing ───────────────────────────────────────────────────────────
  {
    id: 'marketing-campana',
    categoria: 'Marketing',
    pregunta: '¿Cómo le escribo a mis clientes con una promoción?',
    alias: ['mandar una campaña', 'enviar promociones', 'marketing masivo'],
    respuesta: 'Marketing → "Nueva campaña". Filtra a quién le llega (por ejemplo, clientes que vinieron en los últimos 30 días), elige WhatsApp, correo o los dos a la vez, y el número de personas que recibirá el mensaje se muestra antes de enviar. Solo llega a quien tiene permiso vigente.',
  },
  {
    id: 'marketing-generar-texto',
    categoria: 'Marketing',
    pregunta: '¿Puedo pedirle a la IA que me escriba el texto de la campaña?',
    alias: ['redactar promoción con ia', 'generar texto de marketing'],
    respuesta: 'Sí: en "Nueva campaña" hay un cuadro "Generar con IA" — describes qué quieres promocionar (ej. "20% en manicure los martes") y te arma el texto, que puedes editar antes de mandarlo.',
  },
  {
    id: 'marketing-consentimiento',
    categoria: 'Marketing',
    pregunta: '¿Por qué una campaña le llega a menos gente de la que esperaba?',
    alias: ['pocos destinatarios en la campaña', 'no le llega a todos mis clientes'],
    respuesta: 'Solo se le escribe a clientes con consentimiento vigente para ese canal (WhatsApp o correo). Si un cliente no autorizó promociones, o le quitaste el permiso en su ficha, no cuenta para la campaña aunque esté en tu lista.',
  },

  // ── Galería ─────────────────────────────────────────────────────────────
  {
    id: 'galeria-subir',
    categoria: 'Galería',
    pregunta: '¿Cómo subo una foto de un trabajo a la galería?',
    alias: ['publicar un trabajo', 'portafolio de fotos'],
    respuesta: 'Galería → "Subir trabajo". Necesitas marcar que el cliente autorizó publicarla — sin esa autorización, el sistema no deja publicar la foto (ni desde acá ni por accidente).',
  },
  {
    id: 'galeria-privado',
    categoria: 'Galería',
    pregunta: '¿Qué significa "Privado" en una foto de la galería?',
    alias: ['foto no publicada', 'trabajo sin publicar'],
    respuesta: 'La foto está guardada pero no se muestra en la galería pública ni en el portal del cliente. Con el botón "Publicar" de esa tarjeta pasa a visible (si ya tiene autorización del cliente).',
  },

  // ── Encuestas ───────────────────────────────────────────────────────────
  {
    id: 'encuestas-como-funcionan',
    categoria: 'Encuestas',
    pregunta: '¿Cómo funciona la encuesta de satisfacción?',
    alias: ['nps', 'encuesta automática', 'pedir nota a un cliente'],
    respuesta: 'Sale sola por WhatsApp cuando marcas una cita como atendida (el tiempo de espera se configura en Configuración → Encuesta y reseñas). El cliente responde con una nota de 0 a 10; si pone 9 o 10, el agente le pide una reseña en Google con el enlace que configuraste en Integraciones.',
  },
  {
    id: 'encuestas-manual',
    categoria: 'Encuestas',
    pregunta: '¿Puedo anotar la nota de un cliente que me la dijo por teléfono?',
    alias: ['cargar una encuesta a mano', 'registrar una nota manual'],
    respuesta: 'Sí: Encuestas → "Registrar una respuesta", al final de la página. Sirve para cuando el cliente te da su nota en persona o por llamada, no por WhatsApp.',
  },

  // ── Agente IA ───────────────────────────────────────────────────────────
  {
    id: 'agente-apagar',
    categoria: 'Agente IA',
    pregunta: '¿Cómo apago el agente?',
    alias: ['desactivar el bot', 'que el agente deje de responder', 'apagar la ia'],
    respuesta: 'Agente IA → pestaña General → desmarca "Agente habilitado" → "Guardar configuración". Deja de responder por WhatsApp al instante; los mensajes siguen llegando al panel para que los atienda tu equipo.',
  },
  {
    id: 'agente-transferir-persona',
    categoria: 'Agente IA',
    pregunta: '¿Cómo hago que el agente me avise cuando no puede resolver algo?',
    alias: ['transferir a una persona', 'aviso de whatsapp cuando el bot no sabe', 'escalar una conversación'],
    respuesta: 'Agente IA → pestaña General → activa "Permitir transferir a una persona" y configura el número que recibe el aviso. Le llega el nombre y teléfono del cliente, el motivo y lo que escribió — sin número configurado, el aviso solo queda en el panel.',
  },
  {
    id: 'agente-tono',
    categoria: 'Agente IA',
    pregunta: '¿Cómo cambio cómo habla el agente?',
    alias: ['tono del agente', 'que sea más formal', 'que hable más corto'],
    respuesta: 'Agente IA → pestaña Personalidad → elige Cercano, Profesional o Breve. Cambia de verdad cómo escribe en cada mensaje, no es solo cosmético.',
  },
  {
    id: 'agente-voz',
    categoria: 'Agente IA',
    pregunta: '¿El agente puede responder con notas de voz?',
    alias: ['respuestas de audio', 'que el bot mande voz'],
    respuesta: 'Sí, si lo activas en la pestaña Voz. En Comportamiento eliges si responde con voz siempre o solo cuando el cliente le mandó una nota de voz, y si además manda el texto. "Probar voz" usa la configuración ya guardada — guarda cambios antes de probar.',
  },
  {
    id: 'agente-nunca-reserva-solo',
    categoria: 'Agente IA',
    pregunta: '¿El agente puede reservar o cancelar sin que nadie confirme?',
    alias: ['el agente reservó solo', 'seguridad del agente', 'puede el bot equivocarse al reservar'],
    respuesta: 'No: el agente nunca ejecuta una reserva, cambio o cancelación por su cuenta. Solo puede buscar horarios y redactar; quien ejecuta la acción es el sistema, y siempre revalida la disponibilidad real antes de confirmar nada.',
  },

  // ── Integraciones ───────────────────────────────────────────────────────
  {
    id: 'integraciones-whatsapp',
    categoria: 'Integraciones',
    pregunta: '¿Cómo conecto mi WhatsApp?',
    alias: ['vincular whatsapp', 'código qr de whatsapp', 'conectar el número del negocio'],
    respuesta: 'Integraciones → WhatsApp → elige "QR rápido (Evolution)" y escanea el código con el WhatsApp del negocio, igual que cuando vinculas WhatsApp Web.',
  },
  {
    id: 'integraciones-openai',
    categoria: 'Integraciones',
    pregunta: '¿Necesito mi propia clave de OpenAI?',
    alias: ['clave de openai', 'api key de ia', 'de dónde sale la ia del agente'],
    respuesta: 'No es obligatorio: si no cargas tu propia clave en Integraciones, el agente usa la clave de respaldo de la plataforma. Cargar la tuya te da tu propio consumo y límites, separados de los demás negocios.',
  },
  {
    id: 'integraciones-resena-google',
    categoria: 'Integraciones',
    pregunta: '¿Dónde configuro el enlace para pedir reseñas en Google?',
    alias: ['enlace de reseñas', 'pedir reseña en google', 'link de google maps para reseñas'],
    respuesta: 'Integraciones → "Reseñas en Google". Se usa cuando un cliente responde 9 o 10 en la encuesta: el agente le pide la reseña con ese enlace. También se ve (sin poder editarlo ahí) en Configuración.',
  },

  // ── Configuración ───────────────────────────────────────────────────────
  {
    id: 'configuracion-horario-negocio',
    categoria: 'Configuración',
    pregunta: '¿Cómo cambio el horario de atención del negocio?',
    alias: ['horario de apertura', 'días que atiendo', 'cambiar horario general'],
    respuesta: 'Configuración → "Horario de atención del negocio". Es lo que manda sobre el horario de cada profesional: fuera de esas horas no se puede reservar por ningún canal, aunque un profesional tenga cargado ese día en el suyo.',
  },
  {
    id: 'configuracion-zona-horaria',
    categoria: 'Configuración',
    pregunta: '¿Por qué no puedo cambiar la zona horaria o la moneda?',
    alias: ['cambiar moneda', 'cambiar zona horaria', 'moneda bloqueada'],
    respuesta: 'Solo el dueño de la plataforma (Agen) puede cambiarlas, para no desincronizar una agenda ya en marcha. Si necesitas cambiarlas, pídeselo directamente al equipo de Agen.',
  },
  {
    id: 'configuracion-logo',
    categoria: 'Configuración',
    pregunta: '¿Dónde subo el logo de mi negocio?',
    alias: ['cambiar el logo', 'imagen del negocio'],
    respuesta: 'Configuración → "Identidad visual". Aparece en el portal del cliente, en los presupuestos y en los correos (campañas y avisos automáticos como recordatorios). Sin logo, se muestra el nombre del negocio en su lugar.',
  },
  {
    id: 'configuracion-recordatorios',
    categoria: 'Configuración',
    pregunta: '¿Cómo cambio cuándo se le recuerda la hora a un cliente?',
    alias: ['recordatorios automáticos', 'avisos antes de la cita'],
    respuesta: 'Configuración → "Recordatorios al cliente". Eliges con cuántas horas de anticipación se avisa — puedes tener uno, varios, o ninguno.',
  },

  // ── Invitar ─────────────────────────────────────────────────────────────
  {
    id: 'invitar-otro-negocio',
    categoria: 'Invitar',
    pregunta: '¿Cómo invito a otro negocio a conocer Agen?',
    alias: ['recomendar agen', 'referir un colega', 'invitar a un dueño de negocio'],
    respuesta: 'Invitar → comparte tu enlace o tu código. La persona invitada NO crea su cuenta sola: pide que la contactemos, y el equipo de Agen la llama para mostrarle el producto antes de dar de alta nada.',
  },
  {
    id: 'invitar-premio',
    categoria: 'Invitar',
    pregunta: '¿Qué gano si invito a otro negocio?',
    alias: ['descuento por invitar', 'premio por referir'],
    respuesta: 'Si la promoción está activa, la ves en Invitar (el equipo de Agen decide si hay premio ese mes y de cuánto). El descuento se aplica una vez que el negocio invitado se une y el equipo lo confirma.',
  },

  // ── Cuenta y equipo ─────────────────────────────────────────────────────
  {
    id: 'cuenta-cambiar-cuenta',
    categoria: 'Tu cuenta',
    pregunta: '¿Cómo cambio de cuenta si varios profesionales usan el mismo computador?',
    alias: ['varias cuentas en un pc', 'cambiar de usuario'],
    respuesta: 'Menú de tu cuenta (arriba a la derecha) → "Cambiar cuenta". Cierra tu sesión y te lleva al login con tu correo ya escrito — siempre vuelve a pedir la contraseña, no queda ninguna sesión abierta de fondo.',
  },
  {
    id: 'cuenta-recuperar-clave',
    categoria: 'Tu cuenta',
    pregunta: '¿Olvidé mi contraseña, cómo la recupero?',
    alias: ['no recuerdo mi clave', 'restablecer contraseña'],
    respuesta: 'En la pantalla de inicio de sesión, "¿Olvidaste tu contraseña?". Te llega un correo para elegir una nueva.',
  },

  // ── Agenda (detalle) ────────────────────────────────────────────────────
  {
    id: 'agenda-vistas',
    categoria: 'Agenda',
    pregunta: '¿Cómo cambio entre ver el día, la semana o el mes?',
    alias: ['vista de la agenda', 'ver la semana completa', 'ver el mes'],
    respuesta: 'Arriba de la agenda hay un selector Día/Semana/Mes. En vista Día, si hay más de un profesional aparece además "Por profesional" para ver una columna separada por cada uno en vez de todas las citas mezcladas.',
  },
  {
    id: 'agenda-apartados',
    categoria: 'Agenda',
    pregunta: '¿Qué son esos recuadros rayados que dicen "Apartado" en la agenda?',
    alias: ['recuadro punteado en la agenda', 'qué es un apartado', 'hold en la agenda'],
    respuesta: 'Son cupos que el agente de IA reservó temporalmente mientras un cliente decide (por WhatsApp o voz). Desaparecen solos cuando expiran o cuando el cliente confirma. No son clicables y no hay botón para crearlos ni cancelarlos a mano desde la agenda.',
  },
  {
    id: 'agenda-por-cerrar',
    categoria: 'Agenda',
    pregunta: '¿Qué significa el panel "Por cerrar" en la agenda?',
    alias: ['citas por cerrar', 'aviso rojo en una cita vieja'],
    respuesta: 'Son citas cuya hora ya pasó pero siguen en un estado activo (nunca se marcaron Completada ni No asistió). Aparecen en rojo con el aviso "⚠ Por cerrar" y tienen accesos rápidos para marcarlas Completada, No asistió, o abrir la ficha completa.',
  },
  {
    id: 'agenda-bloquear-horario',
    categoria: 'Agenda',
    pregunta: '¿Cómo bloqueo manualmente un horario para que nadie reserve ahí?',
    alias: ['bloquear un hueco de la agenda', 'reservar tiempo para mí'],
    respuesta: 'Hoy no existe un botón para bloquear un horario manualmente en la agenda del negocio. Lo más parecido son los apartados que crea el agente de IA, que son temporales. Para dejar un profesional sin cupos en un rango, ajusta su horario en Equipo → "Horario".',
  },
  {
    id: 'agenda-mini-calendario',
    categoria: 'Agenda',
    pregunta: '¿Qué significan los puntos de colores en el mini calendario de la agenda?',
    alias: ['punto verde en el calendario', 'punto rojo en el calendario'],
    respuesta: 'Verde: ese día tiene citas y no hay ninguna pendiente de cerrar. Rojo: hay al menos una cita pasada que sigue sin marcarse Completada o No asistió. Los días tachados son días que el negocio tiene cerrados en Configuración → Horario de atención.',
  },

  // ── Equipo (detalle) ────────────────────────────────────────────────────
  {
    id: 'equipo-enlace-agenda',
    categoria: 'Equipo',
    pregunta: '¿Por qué el botón "Agenda" de la tarjeta de un profesional no me muestra solo sus citas?',
    alias: ['el botón agenda del profesional no filtra', 'ver solo la agenda de un profesional'],
    respuesta: 'Es una limitación conocida: ese botón lleva a la agenda general, no filtra automáticamente por ese profesional todavía. Para ver solo sus citas, usa el selector de profesional que está arriba de la agenda.',
  },
  {
    id: 'equipo-reconocido-agen',
    categoria: 'Equipo',
    pregunta: '¿Qué es la sección "Equipo reconocido por Agen" al final de Equipo?',
    alias: ['equipo reconocido por agen', 'números que reconoce el agente'],
    respuesta: 'Es distinta de los profesionales: son los teléfonos del dueño, administradores y recepción para que el agente de IA los reconozca cuando escriben (modo equipo, de solo lectura). Los profesionales configuran su propio teléfono en su perfil, no acá. Si el negocio no tiene ningún admin o recepcionista además del dueño, esta sección no aparece.',
  },
  {
    id: 'equipo-horario-al-crear',
    categoria: 'Equipo',
    pregunta: '¿Con qué horario nace un profesional recién creado?',
    alias: ['horario por defecto de un profesional nuevo', 'un profesional nuevo no tiene cupos'],
    respuesta: 'Lunes a viernes de 09:00 a 18:00, automáticamente. Si no lo cambias en "Horario", ese es el horario real que usa el sistema para ofrecerlo. Sin ningún horario cargado, un profesional no genera cupos para nadie.',
  },

  // ── Servicios (detalle) ─────────────────────────────────────────────────
  {
    id: 'servicios-buffer-solo-despues-al-crear',
    categoria: 'Servicios',
    pregunta: '¿Por qué al crear un servicio no puedo poner tiempo de preparación antes, solo después?',
    alias: ['tiempo antes del servicio al crear', 'buffer antes no aparece'],
    respuesta: 'El formulario de "Nuevo servicio" solo trae el tiempo posterior (limpieza/descanso después). El tiempo de preparación previo se agrega editando el servicio ya creado, en "Editar" → "Preparación antes (min)".',
  },
  {
    id: 'servicios-nombre-repetido',
    categoria: 'Servicios',
    pregunta: '¿Por qué no me deja guardar un servicio con ese nombre?',
    alias: ['no se puede crear el servicio', 'nombre de servicio duplicado'],
    respuesta: 'No puede haber dos servicios con el mismo nombre dentro de la misma especialidad. Cámbiale el nombre, o revisa si ya existe uno igual (quizás desactivado) en esa especialidad.',
  },

  // ── Clientes (detalle) ──────────────────────────────────────────────────
  {
    id: 'clientes-buscar-alcance',
    categoria: 'Clientes',
    pregunta: '¿Por qué el buscador de Clientes no encuentra a alguien por su correo?',
    alias: ['buscar cliente por correo no funciona', 'el buscador de clientes qué campos revisa'],
    respuesta: 'El buscador de la lista de Clientes solo busca por nombre o teléfono, no por correo ni por notas. Además la lista trae como máximo 100 clientes sin paginación — si el negocio tiene más y no usas el buscador, algunos no van a aparecer.',
  },
  {
    id: 'clientes-eliminar-confirmacion',
    categoria: 'Clientes',
    pregunta: '¿Por qué me pide escribir una palabra para eliminar un cliente?',
    alias: ['escribir eliminar para borrar', 'confirmación al borrar un cliente'],
    respuesta: 'Para que nadie borre un cliente por un clic distraído: hay que escribir literalmente "ELIMINAR" en el cuadro de confirmación. Además, solo se puede borrar si el cliente no tiene ninguna reserva ni pago registrado.',
  },
  {
    id: 'clientes-consentimiento-diferencia',
    categoria: 'Clientes',
    pregunta: '¿Cuál es la diferencia entre "Acepta promociones" y los permisos de marketing de la ficha?',
    alias: ['casilla de marketing vs permisos por canal', 'consentimiento por canal'],
    respuesta: 'La casilla "Acepta promociones" del formulario sincroniza automáticamente WhatsApp y correo a la vez. Los checkboxes de "Permisos de marketing" en la ficha del cliente tocan cada canal por separado —incluido SMS, que no tiene casilla general— y son los que de verdad deciden si le llega una campaña.',
  },

  // ── Conversaciones (detalle) ────────────────────────────────────────────
  {
    id: 'conversaciones-reabrir-cerrada',
    categoria: 'Conversaciones',
    pregunta: '¿Cómo reabro una conversación que quedó marcada como Cerrada?',
    alias: ['reabrir una conversación cerrada', 'volver a activar una conversación'],
    respuesta: 'Con el botón "Atender yo": aparece en cualquier conversación que no esté en modo "Atiende el equipo", incluidas las cerradas, y la pasa a tu control. Desde ahí, "Devolver al agente" se la entrega de nuevo a la IA.',
  },
  {
    id: 'conversaciones-solo-lectura',
    categoria: 'Conversaciones',
    pregunta: '¿Puedo responder un WhatsApp directamente desde el panel?',
    alias: ['escribir un mensaje desde conversaciones', 'responder al cliente desde el panel'],
    respuesta: 'No: la pantalla de Conversaciones es de solo lectura para los mensajes. Para responder, se hace por WhatsApp de verdad (a mano, o dejando que el agente conteste). Lo que sí puedes hacer desde acá es tomar el control con "Atender yo" para que el agente deje de escribir mientras tú hablas por WhatsApp.',
  },

  // ── Seguimiento (detalle) ───────────────────────────────────────────────
  {
    id: 'seguimiento-tipos-de-tarea',
    categoria: 'Seguimiento',
    pregunta: '¿De dónde salen las tareas de "Qué hacer hoy"?',
    alias: ['tareas automáticas de seguimiento', 'por qué aparece una tarea que no creé'],
    respuesta: 'Se generan solas por tres motivos: una ausencia (no asistió), un presupuesto enviado hace más de 7 días sin respuesta, o un cliente que no viene hace más de 180 días y no tiene ninguna cita futura. También puedes agregar una tarea manual con el botón "Tarea".',
  },
  {
    id: 'seguimiento-espera-una-accion',
    categoria: 'Seguimiento',
    pregunta: '¿Cómo saco a alguien de la lista de espera una vez que ya reservó?',
    alias: ['quitar a alguien de la lista de espera', 'lista de espera reservado'],
    respuesta: 'Desde Seguimiento solo se puede marcar "Contactado". Una vez que esa persona reserva de verdad (por agenda, agente o portal), no hace falta hacer nada más ahí — reservar no la saca automáticamente de la lista visualmente, así que conviene usar "Contactado" como corresponde para no confundirla con alguien a quien aún no le avisaste.',
  },

  // ── Finanzas (detalle) ──────────────────────────────────────────────────
  {
    id: 'finanzas-por-cobrar-no-cambia',
    categoria: 'Finanzas',
    pregunta: '¿Por qué la cifra "Por cobrar" no cambia cuando busco un cliente?',
    alias: ['por cobrar no se filtra con la búsqueda', 'cifra por cobrar fija'],
    respuesta: 'Es a propósito: "Por cobrar" siempre suma TODO lo pendiente del negocio, esté buscando algo o no. Es una cifra del negocio completo, no de la lista filtrada que se está mirando en ese momento.',
  },
  {
    id: 'finanzas-marcar-enviado-no-manda-nada',
    categoria: 'Finanzas',
    pregunta: '¿El botón "Marcar enviado" de un presupuesto lo manda al cliente?',
    alias: ['marcar enviado envía el presupuesto', 'diferencia entre marcar enviado y enviar'],
    respuesta: 'No: "Marcar enviado" en la lista solo cambia la etiqueta de estado, no manda nada. Para enviarlo de verdad por WhatsApp, correo o ambos, hay que abrir la ficha del presupuesto (clic en la fila) y usar los botones de envío de ahí.',
  },
  {
    id: 'finanzas-presupuesto-un-servicio',
    categoria: 'Finanzas',
    pregunta: '¿Puedo poner varios servicios en un mismo presupuesto?',
    alias: ['presupuesto con más de un servicio', 'agregar varios ítems a un presupuesto'],
    respuesta: 'El formulario de "Nuevo presupuesto" arma solo un ítem por presupuesto. Para varios servicios a la vez, hoy hay que crear un presupuesto por cada uno.',
  },
  {
    id: 'finanzas-eliminar-presupuesto-bloqueado',
    categoria: 'Finanzas',
    pregunta: '¿Por qué no puedo eliminar un presupuesto?',
    alias: ['no deja borrar un presupuesto', 'presupuesto con pago no se elimina'],
    respuesta: 'Si ese presupuesto ya tiene un cobro asociado, el sistema no lo deja borrar para no perder el registro del pago.',
  },

  // ── Marketing (detalle) ─────────────────────────────────────────────────
  {
    id: 'marketing-consentimiento-manda-siempre',
    categoria: 'Marketing',
    pregunta: '¿Por qué una campaña le llega a menos gente de la que esperaba aunque cumplan todos los filtros?',
    alias: ['pocos destinatarios aunque cumplen el filtro', 'consentimiento manda sobre los filtros'],
    respuesta: 'El consentimiento de marketing vigente por canal manda sobre cualquier otro filtro (segmento, búsqueda, visitas). Un cliente sin ese permiso jamás cuenta ni recibe la campaña, aunque cumpla todo lo demás.',
  },
  {
    id: 'marketing-retomar-envio',
    categoria: 'Marketing',
    pregunta: '¿Qué hace el botón "Retomar envío" de una campaña?',
    alias: ['retomar envío de campaña', 'campaña que quedó a medias'],
    respuesta: 'Aparece cuando una campaña quedó a medio enviar. Le sigue escribiendo solo a quienes todavía no la recibieron — nunca le manda el mensaje dos veces a quien ya se le entregó.',
  },
  {
    id: 'marketing-canales-sin-envio-real',
    categoria: 'Marketing',
    pregunta: '¿Puedo mandar una campaña por Instagram o Messenger?',
    alias: ['campaña por instagram', 'campaña por messenger', 'notificación push en campañas'],
    respuesta: 'Esos canales aparecen como opción en el formulario, pero hoy no tienen un envío propio implementado — dependen de una integración externa (n8n) que puede no estar configurada. Para un envío confiable, usa WhatsApp, Email, o ambos a la vez.',
  },
  {
    id: 'marketing-diseñar-correo-ia',
    categoria: 'Marketing',
    pregunta: '¿Cómo hago que el correo de una campaña se vea diseñado, no solo texto plano?',
    alias: ['diseñar correo con ia', 'plantilla bonita para el correo de marketing'],
    respuesta: 'En "Nueva campaña", con el canal en Email o Ambos, aparece el botón "Diseñar correo con IA": arma un HTML con tu mensaje ya escrito. Hay que escribir primero el mensaje en el campo de texto. "Volver al correo simple" descarta ese diseño y vuelve al texto plano.',
  },

  // ── Galería (detalle) ───────────────────────────────────────────────────
  {
    id: 'galeria-consentimiento-bloqueado-en-servidor',
    categoria: 'Galería',
    pregunta: '¿Puedo publicar una foto sin marcar la autorización del cliente?',
    alias: ['publicar sin consentimiento', 'saltarse la autorización del cliente en galería'],
    respuesta: 'No: aunque el checkbox de autorización no sea obligatorio para subir la foto, el sistema bloquea publicarla (ahora o después) si no está marcada la autorización del cliente. Es una regla aplicada en el servidor, no solo un aviso visual.',
  },

  // ── Encuestas (detalle) ─────────────────────────────────────────────────
  {
    id: 'encuestas-formula-nps',
    categoria: 'Encuestas',
    pregunta: '¿Cómo se calcula el NPS que aparece en Encuestas?',
    alias: ['qué es el nps', 'fórmula del nps'],
    respuesta: 'NPS = porcentaje de promotores (notas 9 y 10) menos porcentaje de detractores (notas 0 a 6), sobre las respuestas del último año. Las notas 7 y 8 son neutras y no entran en la resta.',
  },
  {
    id: 'encuestas-cuando-sale-automatica',
    categoria: 'Encuestas',
    pregunta: '¿Cuándo le llega la encuesta al cliente después de la cita?',
    alias: ['tiempo de espera de la encuesta', 'cuándo se manda la encuesta automática'],
    respuesta: 'Se controla en Configuración → "Encuesta y reseñas en Google": puedes elegir que salga al instante, 1 hora después, 3 horas después, o al día siguiente, en cuanto marcas la cita como Completada. También puedes apagarla del todo ahí.',
  },
  {
    id: 'encuestas-resena-condicion',
    categoria: 'Encuestas',
    pregunta: '¿Cuándo le pide el agente una reseña en Google al cliente?',
    alias: ['pedido de reseña automático', 'cuándo se pide la reseña'],
    respuesta: 'Solo cuando la nota de la encuesta es 9 o 10, y solo si configuraste el enlace de reseña en Integraciones. Con nota 7-8 el agente agradece y pregunta qué mejorar; con nota 6 o menos, agradece la sinceridad y avisa que se lo pasa al equipo — nunca pide reseña con una nota baja.',
  },

  // ── Agente IA (detalle) ─────────────────────────────────────────────────
  {
    id: 'agente-apagar-efecto-inmediato',
    categoria: 'Agente IA',
    pregunta: '¿Apagar el agente hace efecto al toque?',
    alias: ['el agente sigue respondiendo después de apagarlo', 'la insignia del agente no cambia'],
    respuesta: 'Sí, apagarlo deja de responder por WhatsApp de inmediato al guardar. Ojo: la insignia "● Activo/○ Apagado" arriba de la pantalla solo se actualiza después de guardar con éxito, no apenas destildas la casilla.',
  },
  {
    id: 'agente-formato-telefono-transferencia',
    categoria: 'Agente IA',
    pregunta: '¿Por qué no me deja guardar el número para transferir a una persona?',
    alias: ['número de transferencia inválido', 'formato del teléfono del agente'],
    respuesta: 'El número debe tener entre 8 y 15 dígitos con el código de país, por ejemplo +56912345678. El modal solo exige 8 dígitos como mínimo, pero el servidor valida el formato completo al guardar.',
  },
  {
    id: 'agente-probar-voz-usa-guardado',
    categoria: 'Agente IA',
    pregunta: '¿Por qué "Probar voz" no usa los cambios que acabo de hacer en la pestaña Voz?',
    alias: ['probar voz no refleja mis cambios', 'probar voz con configuración vieja'],
    respuesta: 'El botón "Probar voz" usa la configuración YA GUARDADA en la base de datos, no lo que tengas tecleado sin guardar. Guarda la configuración primero con "Guardar configuración" y recién ahí prueba.',
  },

  // ── Integraciones (detalle) ─────────────────────────────────────────────
  {
    id: 'integraciones-conectar-whatsapp-evolution',
    categoria: 'Integraciones',
    pregunta: '¿Cómo conecto el WhatsApp del negocio paso a paso?',
    alias: ['conectar whatsapp con qr', 'vincular whatsapp evolution'],
    respuesta: 'Integraciones → WhatsApp → elige "QR rápido (Evolution)" → botón "Conectar WhatsApp". Aparece un código QR: ábrelo con el WhatsApp del negocio en Dispositivos vinculados. La pantalla revisa sola cada pocos segundos y muestra "WhatsApp conectado ✓" apenas se vincula, sin que tengas que hacer nada más.',
  },
  {
    id: 'integraciones-desconectar-whatsapp',
    categoria: 'Integraciones',
    pregunta: '¿Qué pasa si aprieto "Desconectar" en WhatsApp?',
    alias: ['desconectar whatsapp del negocio'],
    respuesta: 'Cierra la sesión de WhatsApp y borra esa conexión del todo — para volver a usarlo hay que escanear un QR nuevo desde cero.',
  },
  {
    id: 'integraciones-dialog360-sin-verificar',
    categoria: 'Integraciones',
    pregunta: '¿Puedo confiar en el proveedor 360dialog para WhatsApp?',
    alias: ['360dialog funciona', 'proveedor dialog360'],
    respuesta: 'Ese proveedor todavía no está verificado con un envío real en Agen. Si lo eliges, pruébalo primero con algo sin urgencia antes de depender de él para clientes reales.',
  },
  {
    id: 'integraciones-resend-de-plataforma',
    categoria: 'Integraciones',
    pregunta: '¿Por qué no hay un campo para poner mi propia clave de Resend?',
    alias: ['clave propia de resend', 'correo de marketing sin configurar'],
    respuesta: 'La clave de Resend es compartida por toda la plataforma Agen, no por negocio — la carga el equipo de Agen en Plataforma → Claves. En Integraciones solo ves si está "Activo" o "Sin configurar"; no hay nada que cargar ahí para esto.',
  },

  // ── Configuración (detalle) ─────────────────────────────────────────────
  {
    id: 'configuracion-recordatorios-limite',
    categoria: 'Configuración',
    pregunta: '¿Cuántos recordatorios puedo configurar y con cuánta anticipación?',
    alias: ['máximo de recordatorios', 'límite de anticipación de un recordatorio'],
    respuesta: 'Hasta 4 recordatorios por negocio, cada uno entre 15 minutos y 14 días antes de la hora, sin repetir la misma anticipación dos veces. Sin ninguno configurado, el sistema usa por defecto 24 horas y 2 horas antes.',
  },
  {
    id: 'configuracion-todos-los-dias-cerrados',
    categoria: 'Configuración',
    pregunta: '¿Por qué no me deja guardar el horario del negocio con todos los días cerrados?',
    alias: ['no deja cerrar todos los días', 'horario del negocio todo apagado'],
    respuesta: 'Es a propósito: si todos los días quedan cerrados, nadie podría reservar nunca por ningún canal. El sistema exige dejar al menos un día abierto.',
  },
  {
    id: 'configuracion-exportar-datos',
    categoria: 'Configuración',
    pregunta: '¿Cómo descargo mis clientes, reservas, cobros o gastos a Excel?',
    alias: ['exportar clientes a excel', 'descargar datos del negocio', 'exportar reservas'],
    respuesta: 'Configuración → "Plan y datos" → botones "Exportar a Excel" (uno por Clientes, Reservas, Cobros y Gastos). Descarga un CSV que Excel abre directo, con hasta 5000 filas por exportación.',
  },

  // ── Resumen (panel principal) ───────────────────────────────────────────
  {
    id: 'resumen-ingresos-de-hoy',
    categoria: 'Resumen',
    pregunta: '¿"Ingresos de hoy" del Resumen es lo que se cobró hoy o lo que corresponde a citas de hoy?',
    alias: ['ingresos de hoy qué cuenta', 'por qué los ingresos de hoy no coinciden con las citas de hoy'],
    respuesta: 'Es lo que se COBRÓ hoy (pagos marcados como pagados hoy), no lo que corresponde a citas de hoy. Un pago cobrado hoy de una cita de ayer cuenta acá; una cita de hoy que todavía no se cobra, no cuenta hasta que se marque pagada.',
  },
  {
    id: 'resumen-clientes-nuevos-definicion',
    categoria: 'Resumen',
    pregunta: '¿Qué cuenta como "Cliente nuevo" en el Resumen?',
    alias: ['clientes nuevos del resumen'],
    respuesta: 'Fichas de cliente creadas hoy en el sistema — no necesariamente alguien que vino por primera vez hoy, si su ficha ya existía de antes.',
  },
  {
    id: 'resumen-profesionales-activos-definicion',
    categoria: 'Resumen',
    pregunta: '¿"Profesionales activos" del Resumen cuenta a quién trabaja hoy?',
    alias: ['profesionales activos qué significa'],
    respuesta: 'Cuenta a todos los profesionales con el flag "Activo" en general (no desactivados), sin importar si tienen horario cargado para el día de hoy específicamente.',
  },
]

/** A qué categoría de ARTICULOS_AYUDA pertenece cada pantalla del panel del dueño. */
const RUTA_A_CATEGORIA: Array<[string, string]> = [
  ['/admin/agenda', 'Agenda'],
  ['/admin/equipo', 'Equipo'],
  ['/admin/servicios', 'Servicios'],
  ['/admin/clientes', 'Clientes'],
  ['/admin/conversaciones', 'Conversaciones'],
  ['/admin/seguimiento', 'Seguimiento'],
  ['/admin/finanzas', 'Finanzas'],
  ['/admin/marketing', 'Marketing'],
  ['/admin/galeria', 'Galería'],
  ['/admin/encuestas', 'Encuestas'],
  ['/admin/agente', 'Agente IA'],
  ['/admin/integraciones', 'Integraciones'],
  ['/admin/configuracion', 'Configuración'],
  ['/admin/invitar', 'Invitar'],
]

/**
 * Para que el asistente flotante sepa en qué pantalla está el dueño sin que el navegador le
 * mande nada más que la URL: `null` cuando la pantalla no tiene una categoría propia en la base
 * de ayuda (el Resumen, por ejemplo).
 */
export function categoriaDePagina(pathname: string): string | null {
  if (pathname === '/admin' || pathname === '/admin/') return 'Resumen'
  const encontrada = RUTA_A_CATEGORIA.find(([ruta]) => pathname === ruta || pathname.startsWith(`${ruta}/`))
  return encontrada ? encontrada[1] : null
}

/** Nombre en español de la pantalla actual, para que el asistente lo mencione si hace falta. */
export function nombreDePagina(pathname: string): string {
  if (pathname === '/admin' || pathname === '/admin/') return 'Resumen (panel principal)'
  return categoriaDePagina(pathname) ?? 'el panel de Agen'
}
