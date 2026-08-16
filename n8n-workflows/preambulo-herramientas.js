// Preámbulo común de TODAS las herramientas del agente (nodos toolCode del workflow 01).
//
// Aquí se resuelve una sola cosa, y es la que más veces ha dejado a un cliente sin respuesta:
// leer los argumentos que manda el modelo. n8n los entrega de formas distintas según cómo los
// emita el modelo, y todas se han visto en producción:
//
//   1. `query` (string JSON)                    — el modelo llamó con un único argumento
//   2. el item con los campos sueltos           — llamó con argumentos con nombre; `query` NO existe
//   3. el item con `{ input: "<json>" }`        — variante de la anterior
//   4. el item con `{ tool_uses: [ … ] }`       — lote de llamadas de algunos modelos
//
// Leer solo la primera forma hacía que la herramienta mandara el cuerpo vacío: la app
// respondía 400 y el cliente recibía "hubo un problema técnico" con el horario libre y el
// apartado ya hecho (ejecuciones 7110, 7112 y 7121 del n8n de producción).
//
// Además `typeof query` no lanza con una variable inexistente, pero evaluar `query` sí: por eso
// la primera línea comprueba `typeof` antes de tocarla.
//
// Este archivo es la ÚNICA copia. `npm run n8n -- herramientas` lo inyecta en los ocho nodos,
// así que un arreglo se escribe una vez y no ocho.
const crudo = typeof query === 'undefined' ? null : query;
let q = {};
try { q = typeof crudo === 'string' ? JSON.parse(crudo || '{}') : (crudo || {}); } catch (e) { q = {}; }
if (!q || typeof q !== 'object' || Object.keys(q).length === 0) {
  let item = null;
  try { item = typeof $json !== 'undefined' ? $json : null; } catch (e) { item = null; }
  if (!item) { try { item = $input && $input.item ? $input.item.json : null; } catch (e) { item = null; } }
  if (item && typeof item === 'object') q = item;
}
if (q && typeof q === 'object' && Array.isArray(q.tool_uses) && q.tool_uses.length) {
  const primero = q.tool_uses[0] || {};
  q = primero.parameters || primero.arguments || {};
}
if (q && typeof q === 'object' && typeof q.input === 'string') {
  try { q = JSON.parse(q.input || '{}'); } catch (e) { q = {}; }
}
if (!q || typeof q !== 'object') q = {};

// Una herramienta que no contesta NO puede tumbar la ejecución.
//
// `this.helpers.httpRequest` ignora los códigos HTTP (`ignoreHttpStatusErrors`), pero un timeout,
// un DNS caído o una conexión cortada LANZAN. Sin este envoltorio el nodo reventaba, la ejecución
// moría y el cliente se quedaba esperando para siempre: ni respuesta, ni disculpa, ni reintento.
// Ahora eso vuelve como un resultado más, con su `motivo`, y el modelo sabe qué decir (la tabla
// de motivos está en el prompt del sistema).
//
// `this` no llega dentro de una función anidada en este entorno, así que los helpers se capturan
// antes.
const _helpers = this.helpers;
async function pedirALaApp(opciones) {
  try {
    const r = await _helpers.httpRequest(Object.assign({
      json: true, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: 20000,
    }, opciones));
    return { status: r.statusCode, body: r.body };
  } catch (e) {
    const texto = String((e && (e.message || e.description || e)) || '');
    const seAcaboElTiempo = /timeout|timedout|ETIMEDOUT|ESOCKETTIMEDOUT|aborted|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(texto);
    return {
      status: 0,
      body: {
        error: seAcaboElTiempo ? 'La app no respondió a tiempo' : 'No se pudo llamar a la app',
        motivo: seAcaboElTiempo ? 'TIMEOUT' : 'ERROR_TECNICO',
      },
    };
  }
}
