/** Tipos de `scripts/huella.mjs` (la huella del código compilado). Ver ahí la documentación. */

/** Rutas cuyo contenido decide la huella: lo que cambia el comportamiento desplegado. */
export const RUTAS_DE_LA_HUELLA: string[]

/** Huella a partir de los archivos en disco. La usa el build. */
export function huellaDelDisco(raiz: string): string

/** Huella a partir de pares `[ruta, hashDeBlob]`, el formato común a los dos lados. */
export function huellaDeEntradas(entradas: Array<[string, string]>): string
