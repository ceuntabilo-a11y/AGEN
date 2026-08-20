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
]
