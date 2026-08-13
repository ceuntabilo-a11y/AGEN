import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Memoria del agente sobre un cliente (`client_memory`).
 *
 * UN SOLO ESCRITOR POR CAMPO. Antes había dos sobre `conversation_summary`, con contenidos
 * incompatibles: la herramienta `guardar_memoria` escribía el RESUMEN del modelo (reemplazando
 * el anterior) y `/api/agent/interactions` le pegaba después la TRANSCRIPCIÓN literal del
 * turno. El campo quedaba mitad resumen mitad transcripción, cada escritor borraba lo del
 * otro —los dos hacían leer-modificar-escribir sin control de concurrencia— y el panel
 * "Lo que sabe el agente" mostraba una cosa u otra según quién hubiera escrito último.
 *
 * La transcripción no se pierde: ya se guarda entera, mensaje a mensaje, en
 * `conversations`/`messages` (mismo endpoint), que es donde se lee en Conversaciones.
 *
 * Reparto definitivo:
 * - `conversation_summary`, `known_facts`, `preferences`, `last_intent` → solo `saveAgentMemory`
 *   (la herramienta `guardar_memoria`). El modelo recibe el resumen anterior en el contexto,
 *   así que reescribirlo es acumulativo, no destructivo.
 * - `last_interaction_at` → solo `touchClientMemory`, tras cada respuesta.
 */

export type MemoriaDelModelo = {
  clientId: string
  summary?: string
  lastIntent?: string
  knownFacts?: Record<string, unknown>
  preferences?: Record<string, unknown>
}

/**
 * Marca que acaba de haber una conversación. No toca ningún campo de contenido: el upsert
 * solo actualiza las columnas que manda, así que lo que escribió el modelo queda intacto
 * aunque las dos escrituras se crucen.
 */
export async function touchClientMemory(db: SupabaseClient, datos: { clientId: string }) {
  const ahora = new Date().toISOString()
  const { error } = await db.from('client_memory').upsert({
    client_id: datos.clientId,
    last_interaction_at: ahora,
    updated_at: ahora,
  })
  return !error
}

/**
 * Diagnóstico de las filas anteriores al reparto de escritores (A3), donde el resumen del
 * modelo quedó pegado a la transcripción literal `Cliente: … / Agen: …`.
 *
 * SOLO diagnostica: no se ejecuta ninguna limpieza automática sobre datos ya guardados. El
 * corte es determinista —la primera línea que empieza por "Cliente: " y va seguida de una
 * línea "Agen: " es donde empezaba la transcripción—, pero como el modelo pudo escribir esa
 * misma forma dentro de su resumen, la decisión de aplicarlo queda fuera del código.
 */
export function separarResumenYTranscripcion(guardado: string | null | undefined) {
  const texto = String(guardado ?? '')
  if (!texto.trim()) return { mezclado: false, resumen: texto.trim(), transcripcion: '' }

  const lineas = texto.split('\n')
  const inicio = lineas.findIndex((linea, indice) =>
    /^Cliente:\s/.test(linea) && lineas.slice(indice + 1).some((siguiente) => /^Agen:\s/.test(siguiente)))
  if (inicio < 0) return { mezclado: false, resumen: texto.trim(), transcripcion: '' }

  return {
    mezclado: true,
    resumen: lineas.slice(0, inicio).join('\n').trim(),
    transcripcion: lineas.slice(inicio).join('\n').trim(),
  }
}

/** Único escritor del contenido de la memoria: la herramienta `guardar_memoria`. */
export async function saveAgentMemory(db: SupabaseClient, datos: MemoriaDelModelo) {
  const { data: existente } = await db.from('client_memory')
    .select('conversation_summary,last_intent,known_facts,preferences').eq('client_id', datos.clientId).maybeSingle()
  const { error } = await db.from('client_memory').upsert({
    client_id: datos.clientId,
    conversation_summary: datos.summary?.slice(0, 4000) ?? existente?.conversation_summary ?? null,
    last_intent: datos.lastIntent?.slice(0, 100) ?? existente?.last_intent ?? null,
    known_facts: { ...(existente?.known_facts ?? {}), ...(datos.knownFacts ?? {}) },
    preferences: { ...(existente?.preferences ?? {}), ...(datos.preferences ?? {}) },
    last_interaction_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return !error
}
