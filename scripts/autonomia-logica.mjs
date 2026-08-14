/**
 * Cerebro del ciclo autónomo. Sin red, sin disco y sin reloj: todo entra por parámetro.
 *
 * El ciclo completo es detección → actuación → validación → recuperación → alerta, y corre en
 * GitHub Actions, así que no depende de que ninguna máquina concreta esté encendida. Este
 * módulo es solo el paso de decidir: qué hacer con lo que se observó.
 *
 * Principio: **actuar solo hacia adelante y solo de forma reversible.** La única actuación que
 * este ciclo puede hacer sobre el código es abrir un PR de reversión hacia el último commit
 * verde. Nunca mergea (eso lo protege la regla de rama), nunca reescribe historia, nunca
 * despliega y nunca toca producción. Todo lo demás es alertar.
 *
 * Por qué la reversión no se mergea sola: `main` exige el check "Lint, typecheck, build y E2E",
 * y un PR abierto por el token de Actions no dispara workflows. Mergear sin ese check sería
 * exactamente la clase de atajo que el CI existe para impedir.
 */

/** Lo que el ciclo puede decidir. */
export const ACCIONES = {
  NADA: 'NADA',
  CERRAR_ALERTA: 'CERRAR_ALERTA',
  ROLLBACK: 'ROLLBACK',
  ALERTAR_PRODUCCION: 'ALERTAR_PRODUCCION',
  ALERTAR_SIN_VERDE: 'ALERTAR_SIN_VERDE',
  ALERTAR_ROLLBACK_INVALIDO: 'ALERTAR_ROLLBACK_INVALIDO',
}

/**
 * @param {object} estado
 * @param {boolean} estado.produccionSana       null si no se pudo comprobar (sin AGEN_APP_URL).
 * @param {string|null} estado.ciDeMain         'success' | 'failure' | null (sin ejecución).
 * @param {string|null} estado.ultimoVerde      SHA del último commit de main con CI verde.
 * @param {string} estado.headDeMain            SHA actual de main.
 * @param {boolean} estado.alertaAbierta        ¿Hay una incidencia de autonomía abierta?
 * @param {boolean} [estado.reversionYaAbierta] ¿Ya hay un PR de reversión esperando?
 * @param {boolean} [estado.validacionOk]       Resultado de validar el árbol revertido.
 */
export function decidirAutonomia(estado) {
  const salida = (accion, motivo, detalle = {}) => ({ accion, motivo, ...detalle })

  // 1. Regresión de código: es lo único que este ciclo puede reparar por su cuenta.
  if (estado.ciDeMain === 'failure') {
    if (!estado.ultimoVerde || estado.ultimoVerde === estado.headDeMain) {
      return salida(ACCIONES.ALERTAR_SIN_VERDE,
        'main está en rojo y no hay ningún commit verde anterior al que volver. Esto necesita una persona.')
    }
    if (estado.reversionYaAbierta) {
      return salida(ACCIONES.NADA,
        'main está en rojo y ya hay un PR de reversión esperando. No se abre otro.')
    }
    if (estado.validacionOk === false) {
      return salida(ACCIONES.ALERTAR_ROLLBACK_INVALIDO,
        'La reversión al último commit verde tampoco pasa la validación local: revertir no arregla esto.',
        { hasta: estado.ultimoVerde })
    }
    return salida(ACCIONES.ROLLBACK,
      `main está en rojo. Se propone volver a ${String(estado.ultimoVerde).slice(0, 7)}, el último commit verde.`,
      { hasta: estado.ultimoVerde })
  }

  // 2. Producción caída con el código verde: no es una regresión del repositorio, así que
  //    revertir no arreglaría nada. Es infraestructura, y ahí hace falta una persona.
  if (estado.produccionSana === false) {
    return salida(ACCIONES.ALERTAR_PRODUCCION,
      'Producción no responde y el código de main está verde: no es una regresión del repositorio. Revertir no lo arreglaría.')
  }

  // 3. Todo bien. Si quedaba una alerta de un corte anterior, se cierra sola.
  if (estado.alertaAbierta) {
    return salida(ACCIONES.CERRAR_ALERTA, 'Todo volvió a estar sano: se cierra la alerta del corte anterior.')
  }

  return salida(ACCIONES.NADA, 'Producción sana y main en verde. No hay nada que hacer.')
}

/** ¿Esta acción escribe algo en GitHub? Sirve para que el modo simulación sea explícito. */
export function esAccionQueEscribe(accion) {
  return accion !== ACCIONES.NADA
}
