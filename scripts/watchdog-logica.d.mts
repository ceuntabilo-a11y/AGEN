/** Tipos de `scripts/watchdog-logica.mjs` (el cerebro del watchdog). */

export type Veredicto = 'TERMINADO' | 'ESPERANDO' | 'HAY_TRABAJO' | 'INTERVENCION_HUMANA' | 'ATASCADO'

export interface ConteoBacklog {
  hechos: number
  pendientes: number
  bloqueados: number
  total: number
}

export interface EstadoCi {
  id: string
  estado: string
  conclusion: string | null
}

export interface EstadoObservado {
  rama?: string
  head: string
  sucio: number
  sinEmpujar: number
  ci?: EstadoCi | null
  backlog?: ConteoBacklog
  ghDisponible?: boolean
}

export interface Decision {
  veredicto: Veredicto
  motivo: string
  siguienteComando: string | null
  huella: string
  codigoSalida: number
}

export declare const CODIGOS: Record<Veredicto, number>
export declare function decidir(estado: EstadoObservado, anterior?: { huella?: string } | null): Decision
export declare function contarBacklog(markdown: string): ConteoBacklog
