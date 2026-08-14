/** Tipos de `scripts/politica.mjs` (el cerebro del Approval Gateway). Ver ahí la documentación. */

export type Decision = 'auto' | 'bloqueado' | 'humano'

export interface Politica {
  allow: string[]
  ask: string[]
  deny: string[]
}

export interface Clasificacion {
  decision: Decision
  motivo: string
  regla: string | null
}

export interface Fallo {
  accion: string
  esperado: Decision
  obtenido: Decision
}

export declare const NUNCA: string[]
export declare const SIEMPRE_AUTO: string[]

export declare function patronARegExp(patron: string): RegExp
export declare function coincide(regla: string, herramienta: string, comando: string): boolean
export declare function parsearPolitica(contenido: string): Politica
export declare function clasificar(
  comando: string,
  opciones: { herramienta?: string; politica: Politica },
): Clasificacion
export declare function auditar(politica: Politica): { ok: boolean; fallos: Fallo[] }
