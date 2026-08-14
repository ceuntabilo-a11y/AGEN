import { execFileSync } from 'node:child_process'

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    AGEN_COMMIT: COMMIT,
    AGEN_COMPILADO: COMPILADO,
  },
  async headers() {
    return [{source:'/:path*',headers:[
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
      {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
      {key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'},
      {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"},
    ]}]
  },
}

export default nextConfig
