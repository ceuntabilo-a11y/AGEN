import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { huellaDelDisco } from './scripts/huella.mjs'

/**
 * Commit desplegado, resuelto EN EL BUILD.
 *
 * Existe para poder responder "¿qué versión está viva en producción?" sin entrar al panel de
 * EasyPanel. Sin esto no había forma de saber si un arreglo mergeado en `main` había llegado
 * de verdad al servidor, y eso convertía cualquier verificación contra producción en una
 * suposición.
 *
 * Se resuelve al compilar y no en cada petición: el `.git` puede no existir en la imagen que
 * corre, y `/api/health` tiene que ser barato.
 *
 * Orden de preferencia: una variable explícita, las que ponen los CI conocidos, y por último
 * `git rev-parse`. Si nada funciona, `desconocido` — nunca se inventa un valor.
 */
function commitDelBuild() {
  const delEntorno = process.env.AGEN_COMMIT
    || process.env.GITHUB_SHA
    || process.env.SOURCE_COMMIT
    || process.env.COMMIT_SHA
    || process.env.RAILWAY_GIT_COMMIT_SHA
  if (delEntorno) return delEntorno.trim()
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'desconocido'
  }
}

const COMMIT = commitDelBuild()
const COMPILADO = new Date().toISOString()

/**
 * Huella del código compilado. Es el respaldo cuando el commit no se puede resolver.
 *
 * En EasyPanel el contenedor de compilación no trae `.git` ni ninguna variable con el SHA, así
 * que `commitDelBuild()` devuelve `desconocido` justo donde más falta hace. Comprobado contra
 * producción tras desplegar: la ruta nueva estaba viva y el commit vacío.
 *
 * La huella no depende de nada del entorno —es un hash del contenido de `src`, `package.json`
 * y este archivo— y contesta la misma pregunta: si lo que corre es lo que hay en `main`.
 * Ver `scripts/huella.mjs`.
 */
function huellaDelBuild() {
  try {
    return huellaDelDisco(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    return 'desconocida'
  }
}

const HUELLA = huellaDelBuild()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    AGEN_COMMIT: COMMIT,
    AGEN_COMPILADO: COMPILADO,
    AGEN_HUELLA: HUELLA,
  },
  async headers() {
    /*
     * Cloudflare Web Analytics, y solo eso.
     *
     * Cloudflare inyecta su baliza (`static.cloudflareinsights.com/beacon.min.js`) en todas las
     * páginas del dominio, y la CSP la bloqueaba: **cada carga de página** dejaba un error de
     * CSP en la consola del cliente y la analítica del dueño no recogía absolutamente nada.
     * Comprobado contra producción, no supuesto: es lo que hizo fallar las 17 pruebas de rol al
     * ejecutarlas contra la aplicación desplegada.
     *
     * Dos cosas importaban a la vez: que la analítica funcione, y que un error en la consola
     * vuelva a significar algo. Con ruido en todas las páginas, ninguna prueba de "sin errores
     * de consola" puede pasar contra producción, y eso es justo lo que esconde los fallos de
     * verdad.
     *
     * Se añade **un host concreto** —el de la propia CDN del dominio— a `script-src` y
     * `connect-src`, no un comodín. No se toca nada más de la política.
     */
    const CLOUDFLARE_ANALYTICS = 'https://static.cloudflareinsights.com'
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CLOUDFLARE_ANALYTICS}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${CLOUDFLARE_ANALYTICS}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [{source:'/:path*',headers:[
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
      {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
      {key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'},
      {key:'Content-Security-Policy',value:csp},
    ]}]
  },
}

export default nextConfig
