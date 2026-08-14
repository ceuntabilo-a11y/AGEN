/** Tipos de `scripts/autonomia-logica.mjs` (el cerebro del ciclo autónomo). */

export type Accion =
  | 'NADA'
  | 'CERRAR_ALERTA'
  | 'ROLLBACK'
  | 'ALERTAR_PRODUCCION'
  | 'ALERTAR_SIN_VERDE'
  | 'ALERTAR_ROLLBACK_INVALIDO'

export interface EstadoAutonomia {
  produccionSana: boolean | null
  ciDeMain: string | null
  ultimoVerde: string | null
  headDeMain: string
  alertaAbierta: boolean
  reversionYaAbierta?: boolean
  validacionOk?: boolean
}

export interface DecisionAutonomia {
  accion: Accion
  motivo: string
  hasta?: string | null
}

export declare const ACCIONES: Record<Accion, Accion>
export declare function decidirAutonomia(estado: EstadoAutonomia): DecisionAutonomia
export declare function esAccionQueEscribe(accion: Accion): boolean
